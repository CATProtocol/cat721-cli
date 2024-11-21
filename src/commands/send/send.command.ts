import { Command, Option } from 'nest-commander';
import { logerror, getNft } from 'src/common';
import {
  ConfigService,
  getProviders,
  SpendService,
  WalletService,
} from 'src/providers';
import { Inject } from '@nestjs/common';
import {
  BoardcastCommand,
  BoardcastCommandOptions,
} from '../boardcast.command';
import { findCollectionInfoById } from 'src/collection';
import {
  Cat721Metadata,
  Cat721NftInfo,
  singleSendNft,
  toTokenAddress,
  btc,
} from '@cat-protocol/cat-sdk';

interface SendCommandOptions extends BoardcastCommandOptions {
  id: string;
  localId: bigint;
  address: string;
  amount: bigint;
  config?: string;
}

@Command({
  name: 'send',
  description: 'Send tokens',
})
export class SendCommand extends BoardcastCommand {
  constructor(
    @Inject() private readonly spendService: SpendService,
    @Inject() protected readonly walletService: WalletService,
    @Inject() protected readonly configService: ConfigService,
  ) {
    super(spendService, walletService, configService);
  }
  async cat_cli_run(
    inputs: string[],
    options?: SendCommandOptions,
  ): Promise<void> {
    if (!options.id) {
      logerror('expect a nft collectionId option', new Error());
      return;
    }

    if (typeof options.localId === 'undefined') {
      logerror('expect a nft localId option', new Error());
      return;
    }

    try {
      const address = await this.walletService.getAddress();
      const collectionInfo = await findCollectionInfoById(
        this.configService,
        options.id,
      );

      if (!collectionInfo) {
        throw new Error(
          `No collection info found for collectionId: ${options.id}`,
        );
      }

      let receiver: btc.Address;
      try {
        receiver = btc.Address.fromString(inputs[0]);

        if (
          receiver.type !== 'taproot' &&
          receiver.type !== 'witnesspubkeyhash'
        ) {
          console.error(`Invalid address type: ${receiver.type}`);
          return;
        }
      } catch (error) {
        console.error(`Invalid receiver address: "${inputs[0]}" `);
        return;
      }

      await this.send(collectionInfo, receiver, address, options);
      return;
    } catch (error) {
      logerror(`send token failed!`, error);
    }
  }

  async send(
    collectionInfo: Cat721NftInfo<Cat721Metadata>,
    receiver: btc.Address,
    address: btc.Address,
    options: SendCommandOptions,
  ) {
    const feeRate = await this.getFeeRate();

    const nft = await getNft(
      this.configService,
      collectionInfo,
      options.localId,
    );

    if (!nft) {
      console.error('getNft return null!');
      return;
    }

    if (nft.state.ownerAddr !== toTokenAddress(address)) {
      console.log(
        `${collectionInfo.collectionId}:${options.localId} nft is not owned by your address ${address}`,
      );
      return;
    }

    const { chainProvider, utxoProvider } = getProviders(
      this.configService,
      this.walletService,
    );

    const result = await singleSendNft(
      this.walletService,
      utxoProvider,
      chainProvider,
      collectionInfo.minterAddr,
      [nft],
      [toTokenAddress(receiver)],
      feeRate,
    );

    const sendTx = result.sendTx.extractTransaction();
    console.log(
      `Sending ${collectionInfo.collectionId}:${options.localId} nft  to ${receiver} \nin txid: ${sendTx.getId()}`,
    );
  }

  @Option({
    flags: '-i, --id [collectionId]',
    description: 'ID of the nft collection',
  })
  parseId(val: string): string {
    return val;
  }

  @Option({
    flags: '-l, --localId [localId]',
    description: 'localId of the nft',
  })
  parseLocalId(val: string): bigint {
    try {
      return BigInt(val);
    } catch (error) {
      throw new Error(`Invalid localId: ${val}`);
    }
  }
}
