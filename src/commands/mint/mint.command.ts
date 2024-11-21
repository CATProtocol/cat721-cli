import { Command, Option } from 'nest-commander';
import { logerror, getNFTMinter, isNFTParallelClosedMinter } from 'src/common';
import {
  ConfigService,
  getProviders,
  SpendService,
  WalletService,
} from 'src/providers';
import { Inject } from '@nestjs/common';
import { findCollectionInfoById } from 'src/collection';
import {
  BoardcastCommand,
  BoardcastCommandOptions,
} from '../boardcast.command';
import { isAbsolute, join } from 'path';
import { accessSync, constants, existsSync, readFileSync } from 'fs';
import { mintNft, toTokenAddress, btc } from '@cat-protocol/cat-sdk';
import { Ripemd160 } from 'scrypt-ts';

interface MintCommandOptions extends BoardcastCommandOptions {
  id: string;
  resource: string;
  owner?: Ripemd160;
  type?: string;
}

@Command({
  name: 'mint',
  description: 'Mint a NFT token',
})
export class MintCommand extends BoardcastCommand {
  constructor(
    @Inject() private readonly spendService: SpendService,
    @Inject() protected readonly walletService: WalletService,
    @Inject() protected readonly configService: ConfigService,
  ) {
    super(spendService, walletService, configService);
  }

  async cat_cli_run(
    passedParams: string[],
    options?: MintCommandOptions,
  ): Promise<void> {
    try {
      if (!options.id) {
        throw new Error('expect a ID option');
      }

      const resourceDir = options.resource
        ? options.resource
        : join(process.cwd(), 'resource');

      const contentType = options.type || 'image/png';

      const address = await this.walletService.getAddress();
      const collectionInfo = await findCollectionInfoById(
        this.configService,
        options.id,
      );

      if (!collectionInfo) {
        console.error(
          `No NFT collection info found for collectionId: ${options.id}`,
        );
        return;
      }

      const feeRate = await this.getFeeRate();

      const { chainProvider, utxoProvider } = getProviders(
        this.configService,
        this.walletService,
      );

      const minter = await getNFTMinter(
        this.configService,
        chainProvider,
        collectionInfo,
        this.spendSerivce,
      );

      if (minter == null) {
        console.error(
          `no NFT [${collectionInfo.metadata.symbol}] minter found`,
        );
        return;
      }

      if (isNFTParallelClosedMinter(collectionInfo.metadata.minterMd5)) {
        const contentBody = this.readNFTFile(
          resourceDir,
          minter.state.nextLocalId,
          contentType,
        );

        const metadata = this.readMetaData(
          resourceDir,
          minter.state.nextLocalId,
        );
        const result = await mintNft(
          this.walletService,
          utxoProvider,
          chainProvider,
          toTokenAddress(address),
          minter,
          collectionInfo.collectionId,
          collectionInfo.metadata,
          options.owner || toTokenAddress(address),
          feeRate,
          contentType,
          contentBody,
          metadata,
        );
        const nftTx = result.nftTx.extractTransaction();
        const mintTx = result.mintTx.extractTransaction();
        this.spendService.updateTxsSpends([nftTx, mintTx]);

        console.log(
          `Minting ${collectionInfo.metadata.symbol}:${minter.state.nextLocalId} NFT in txid: ${mintTx.getId()} ...`,
        );
      } else {
        throw new Error('Unkown minter');
      }
    } catch (error) {
      logerror('mint failed!', error);
    }
  }

  @Option({
    flags: '-i, --id [tokenId]',
    description: 'ID of the token',
  })
  parseId(val: string): string {
    return val;
  }

  @Option({
    flags: '-r, --resource [resource]',
    description: 'resource of the minted nft token',
  })
  parseResource(val: string): string {
    if (!val) {
      logerror("resource can't be empty!", new Error());
      process.exit(0);
    }

    const resource = isAbsolute(val) ? val : join(process.cwd(), val);

    try {
      accessSync(resource, constants.R_OK);
      return resource;
    } catch (error) {
      logerror(`can\'t access resource file: ${resource}`, error);
      process.exit(0);
    }
  }

  @Option({
    flags: '-t, --type [type]',
    description: 'content type of the resource',
  })
  parseType(val: string): string {
    if (!val) {
      logerror("resource can't be empty!", new Error());
      process.exit(0);
    }

    return val;
  }

  @Option({
    flags: '-o, --owner [owner]',
    description: 'mint nft into a owner',
  })
  parseOwner(val: string): Ripemd160 {
    if (!val) {
      logerror("owner can't be empty!", new Error());
      process.exit(0);
    }
    const HEX_Exp = /^#[0-9A-Fa-f]{20}$/i;
    if (HEX_Exp.test(val)) {
      return Ripemd160(val);
    }

    let receiver: btc.Address;
    try {
      receiver = btc.Address.fromString(val);

      if (
        receiver.type === 'taproot' ||
        receiver.type === 'witnesspubkeyhash'
      ) {
        return toTokenAddress(receiver);
      } else {
        console.error(`Invalid owner address type: "${receiver.type}" `);
      }
    } catch (error) {
      console.error(`Invalid owner address: "${val}" `);
    }
    return;
  }

  readNFTFile(resource: string, localId: bigint, type: string) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [_, ext] = type.split('/');
    if (!ext) {
      throw new Error(`unknow type: ${type}`);
    }
    return readFileSync(join(resource, `${localId}.${ext}`)).toString('hex');
  }

  readMetaData(resource: string, localId: bigint): object | undefined {
    const metadata = {
      localId: localId,
    };

    try {
      const metadataFile = join(resource, `${localId}.json`);

      if (existsSync(metadataFile)) {
        const str = readFileSync(metadataFile).toString();
        const obj = JSON.parse(str);
        Object.assign(metadata, obj);
      }
    } catch (error) {
      logerror(`readMetaData FAIL, localId: ${localId}`, error);
    }
    return metadata;
  }
}
