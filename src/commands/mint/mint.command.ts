import { Command, Option } from 'nest-commander';
import {
  getUtxos,
  logerror,
  btc,
  getNFTOpenMinter,
  isNFTOpenMinter,
  isNFTClosedMinter,
  getNFTClosedMinter,
  toTokenAddress,
} from 'src/common';
import { ConfigService, SpendService, WalletService } from 'src/providers';
import { Inject } from '@nestjs/common';
import { findCollectionInfoById } from 'src/collection';
import {
  BoardcastCommand,
  BoardcastCommandOptions,
} from '../boardcast.command';
import { isAbsolute, join } from 'path';
import { accessSync, constants, existsSync, readFileSync } from 'fs';
import { generateCollectionMerkleTree } from '../deploy/nft.open-mint';
import { openMint } from './nft.open-mint';
import { closedMint } from './nft.closed-mint';

interface MintCommandOptions extends BoardcastCommandOptions {
  id: string;
  resource: string;
  owner?: string;
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

      const address = this.walletService.getAddress();
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
      const feeUtxos = await this.getFeeUTXOs(address);

      if (feeUtxos.length === 0) {
        console.warn('Insufficient satoshis balance!');
        return;
      }

      if (isNFTOpenMinter(collectionInfo.metadata.minterMd5)) {
        const pubkeyX = this.walletService.getXOnlyPublicKey();
        const collectionMerkleTree = generateCollectionMerkleTree(
          collectionInfo.metadata.max,
          pubkeyX,
          contentType,
          resourceDir,
        );

        const minter = await getNFTOpenMinter(
          this.configService,
          collectionInfo,
          collectionMerkleTree,
        );

        if (minter == null || !this.spendSerivce.isUnspent(minter.utxo)) {
          console.error(
            `no NFT [${collectionInfo.metadata.symbol}] minter found`,
          );
          return;
        }

        const contentBody = this.readNFTFile(
          resourceDir,
          minter.state.data.nextLocalId,
          contentType,
        );

        const metadata = this.readMetaData(
          resourceDir,
          minter.state.data.nextLocalId,
        );

        const res = await openMint(
          this.configService,
          this.walletService,
          this.spendSerivce,
          feeRate,
          feeUtxos,
          collectionInfo,
          minter,
          collectionMerkleTree,
          contentType,
          contentBody,
          metadata,
          options.owner,
        );

        if (res instanceof Error) {
          throw res;
        }

        console.log(
          `Minting ${collectionInfo.metadata.symbol}:${minter.state.data.nextLocalId} NFT in txid: ${res} ...`,
        );
      } else if (isNFTClosedMinter(collectionInfo.metadata.minterMd5)) {
        const minter = await getNFTClosedMinter(
          this.configService,
          collectionInfo,
          this.spendSerivce,
        );

        if (minter == null) {
          console.error(
            `no NFT [${collectionInfo.metadata.symbol}] minter found`,
          );
          return;
        }
        const contentBody = this.readNFTFile(
          resourceDir,
          minter.state.data.nextLocalId,
          contentType,
        );

        const metadata = this.readMetaData(
          resourceDir,
          minter.state.data.nextLocalId,
        );

        const res = await closedMint(
          this.configService,
          this.walletService,
          this.spendSerivce,
          feeRate,
          feeUtxos,
          collectionInfo,
          minter,
          contentType,
          contentBody,
          metadata,
          options.owner,
        );

        if (res instanceof Error) {
          throw res;
        }

        console.log(
          `Minting ${collectionInfo.metadata.symbol}:${minter.state.data.nextLocalId} NFT in txid: ${res} ...`,
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
  parseOwner(val: string): string {
    if (!val) {
      logerror("owner can't be empty!", new Error());
      process.exit(0);
    }
    const HEX_Exp = /^#[0-9A-Fa-f]{20}$/i;
    if (HEX_Exp.test(val)) {
      return val;
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

  @Option({
    flags: '-s, --stop [stopId]',
    description: 'stop minting at a localId',
  })
  parseStopId(val: string): bigint {
    if (!val) {
      logerror("owner can't be empty!", new Error());
      process.exit(0);
    }

    return BigInt(val);
  }

  async getFeeUTXOs(address: btc.Address) {
    let feeUtxos = await getUtxos(
      this.configService,
      this.walletService,
      address,
    );

    feeUtxos = feeUtxos.filter((utxo) => {
      return this.spendService.isUnspent(utxo);
    });
    return feeUtxos;
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
