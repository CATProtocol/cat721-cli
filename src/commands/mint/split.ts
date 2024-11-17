import { UTXO } from 'scrypt-ts';
import { ConfigService, WalletService } from 'src/providers';
import { btc, broadcast, log } from 'src/common';
export async function feeSplitTx(
  configService: ConfigService,
  walletService: WalletService,
  feeUtxos: UTXO[],
  feeRate: number,
  count: number,
) {
  const address = walletService.getAddress();
  const splitFeeTx = new btc.Transaction();

  splitFeeTx.from(feeUtxos);

  function calcVsize(walletService: WalletService): number {
    const _splitFeeTx = new btc.Transaction();

    _splitFeeTx.from(feeUtxos);

    for (let i = 0; i < count; i++) {
      _splitFeeTx.addOutput(
        new btc.Transaction.Output({
          satoshis: 0,
          script: btc.Script.fromAddress(address),
        }),
      );
    }
    _splitFeeTx.feePerByte(feeRate);
    walletService.signTx(_splitFeeTx);
    return _splitFeeTx.vsize;
  }

  const vSize = calcVsize(walletService);

  const fee = vSize * feeRate;

  const satoshisPerOutput = Math.floor((splitFeeTx.inputAmount - fee) / count);

  for (let i = 0; i < count; i++) {
    splitFeeTx.addOutput(
      new btc.Transaction.Output({
        satoshis: satoshisPerOutput,
        script: btc.Script.fromAddress(address),
      }),
    );
  }

  walletService.signTx(splitFeeTx);

  //const txId = splitFeeTx.id;
  const txId = await broadcast(
    configService,
    walletService,
    splitFeeTx.uncheckedSerialize(),
  );
  if (txId instanceof Error) {
    throw txId;
  } else {
    log(`Spliting fee in txid: ${txId}`);
  }

  const newfeeUtxos: UTXO[] = [];

  for (let i = 0; i < count; i++) {
    newfeeUtxos.push({
      txId,
      outputIndex: i,
      script: splitFeeTx.outputs[i].script.toHex(),
      satoshis: splitFeeTx.outputs[i].satoshis,
    });
  }
  return { txId: splitFeeTx.id, newfeeUtxos };
}
