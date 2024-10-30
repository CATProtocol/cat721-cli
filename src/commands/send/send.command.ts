import { Command, Option } from 'nest-commander';
import {
  logerror,
  btc,
  CollectionInfo,
  getUtxos,
  broadcast,
  getNft,
  toTokenAddress,
} from 'src/common';
import { ConfigService, SpendService, WalletService } from 'src/providers';
import { Inject } from '@nestjs/common';
import {
  BoardcastCommand,
  BoardcastCommandOptions,
} from '../boardcast.command';
import { findCollectionInfoById } from 'src/collection';
import { sendNfts } from './nft';
import { pickLargeFeeUtxo } from './pick';

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
      const address = this.walletService.getAddress();
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

        if (receiver.type !== 'taproot') {
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
    collectionInfo: CollectionInfo,
    receiver: btc.Address,
    address: btc.Address,
    options: SendCommandOptions,
  ) {
    const feeRate = await this.getFeeRate();

    let feeUtxos = await getUtxos(
      this.configService,
      this.walletService,
      address,
    );

    feeUtxos = feeUtxos.filter((utxo) => {
      return this.spendService.isUnspent(utxo);
    });

    if (feeUtxos.length === 0) {
      console.warn('Insufficient satoshis balance!');
      return;
    }

    const nft = await getNft(
      this.configService,
      collectionInfo,
      options.localId,
    );

    if (!nft) {
      console.error('getNft return null!');
      return;
    }

    if (nft.state.data.ownerAddr !== toTokenAddress(address)) {
      console.log(
        `${collectionInfo.collectionId}:${options.localId} nft is not owned by your address ${address}`,
      );
      return;
    }

    const feeUtxo = pickLargeFeeUtxo(feeUtxos);
    if (!nft) {
      console.error(`No nft localId = ${options.localId} found!`);
      return;
    }

    const cachedTxs: Map<string, btc.Transaction> = new Map();
    const result = await sendNfts(
      this.configService,
      this.walletService,
      feeUtxo,
      feeRate,
      collectionInfo,
      [nft],
      address,
      receiver,
      cachedTxs,
    );

    if (result) {
      const commitTxId = await broadcast(
        this.configService,
        this.walletService,
        result.commitTx.uncheckedSerialize(),
      );

      if (commitTxId instanceof Error) {
        throw commitTxId;
      }

      this.spendService.updateSpends(result.commitTx);

      const revealTxId = await broadcast(
        this.configService,
        this.walletService,
        result.revealTx.uncheckedSerialize(),
      );

      if (revealTxId instanceof Error) {
        throw revealTxId;
      }

      this.spendService.updateSpends(result.revealTx);

      console.log(
        `Sending ${collectionInfo.collectionId}:${options.localId} nft  to ${receiver} \nin txid: ${result.revealTx.id}`,
      );
    }
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
