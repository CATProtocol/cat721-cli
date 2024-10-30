import { UTXO } from 'scrypt-ts';
import { WalletService } from 'src/providers';
import { btc, Postage, script2P2TR } from 'src/common';
import { getCatNFTCommitScript } from '@cat-protocol/cat-smartcontracts';

export function unlockNFT(
  wallet: WalletService,
  commitTx: btc.Transaction,
  revealTx: btc.Transaction,
  lockingScript: btc.Script,
  cblock: string,
  txCtx: any,
  verify: boolean = false,
) {
  const nftInputIndex = 1;
  const witnesses: Buffer[] = [];

  const { sighash } = txCtx;

  const sig = btc.crypto.Schnorr.sign(
    wallet.getTaprootPrivateKey(),
    sighash.hash,
  );

  witnesses.push(sig);
  witnesses.push(lockingScript);
  witnesses.push(Buffer.from(cblock, 'hex'));

  if (verify) {
    const interpreter = new btc.Script.Interpreter();
    const flags =
      btc.Script.Interpreter.SCRIPT_VERIFY_WITNESS |
      btc.Script.Interpreter.SCRIPT_VERIFY_TAPROOT;

    const res = interpreter.verify(
      new btc.Script(''),
      commitTx.outputs[0].script,
      revealTx,
      nftInputIndex,
      flags,
      witnesses,
      commitTx.outputs[0].satoshis,
    );

    if (!res) {
      console.error('reveal nft faild!', interpreter.errstr);
      return false;
    }
  }

  revealTx.inputs[nftInputIndex].witnesses = witnesses;
  return true;
}

export function createNft(
  wallet: WalletService,
  feeRate: number,
  feeUtxos: UTXO[],
  changeAddress: btc.Address,
  contentType: string,
  contentBody: string,
  nftmetadata: object,
): {
  commitTx: btc.Transaction;
  feeUTXO: UTXO;
  nftCommitScript: btc.Script;
} {
  const pubkeyX = wallet.getXOnlyPublicKey();
  const nftCommitScript = getCatNFTCommitScript(pubkeyX, nftmetadata, {
    type: contentType,
    body: contentBody,
  });

  const lockingScript = Buffer.from(nftCommitScript, 'hex');
  const { p2tr: p2tr } = script2P2TR(lockingScript);

  const commitTx = new btc.Transaction()
    .from(feeUtxos)
    .addOutput(
      new btc.Transaction.Output({
        satoshis: Postage.NFT_POSTAGE,
        script: p2tr,
      }),
    )
    .feePerByte(feeRate)
    .change(changeAddress);

  if (commitTx.getChangeOutput() === null) {
    console.error('Insufficient satoshis balance!');
    return null;
  }
  commitTx.getChangeOutput().satoshis -= 1;
  wallet.signTx(commitTx);
  return {
    commitTx,
    nftCommitScript: lockingScript,
    feeUTXO: {
      txId: commitTx.id,
      outputIndex: 1,
      satoshis: commitTx.outputs[1].satoshis,
      script: commitTx.outputs[1].script.toHex(),
    },
  };
}
