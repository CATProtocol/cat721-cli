import { UTXO } from 'scrypt-ts';
import {
  broadcast,
  script2P2TR,
  toStateScript,
  p2tr2Address,
  outpoint2ByteString,
  Postage,
  btc,
  logerror,
  getNftClosedMinterContractP2TR,
  toTokenAddress,
  CollectionMetadata,
  getNFTContractP2TR,
} from 'src/common';

import {
  ProtocolState,
  getSHPreimage,
  NftClosedMinterProto,
  NftClosedMinterState,
  int32,
  getCatCollectionCommitScript,
} from '@cat-protocol/cat-smartcontracts';
import { ConfigService, WalletService } from 'src/providers';

function getMinter(wallet: WalletService, genesisId: string, max: int32) {
  const issuerAddress = wallet.getAddress();
  return getNftClosedMinterContractP2TR(
    toTokenAddress(issuerAddress),
    genesisId,
    max,
  );
}

export function getMinterInitialTxState(
  nftP2TR: string,
  collectionMax: bigint,
): {
  protocolState: ProtocolState;
  states: NftClosedMinterState[];
} {
  const protocolState = ProtocolState.getEmptyState();

  const quotaStep = collectionMax / 5n;

  const mod = collectionMax % 5n;

  const states: NftClosedMinterState[] = [];

  for (let i = 0; i < 5; i++) {
    const start = quotaStep * BigInt(i);
    let quotaMaxLocalId = start + quotaStep;
    if (i == 4) {
      quotaMaxLocalId += mod;
    }

    const state = NftClosedMinterProto.create(nftP2TR, quotaMaxLocalId, start);

    states.push(state);

    const outputState = NftClosedMinterProto.toByteString(state);
    protocolState.updateDataList(i, outputState);
  }

  return {
    protocolState,
    states,
  };
}

const buildRevealTx = (
  wallet: WalletService,
  genesisId: string,
  lockingScript: Buffer,
  metadata: CollectionMetadata,
  commitTx: btc.Transaction,
  feeRate: number,
): btc.Transaction => {
  const { p2tr: minterP2TR } = getMinter(
    wallet,
    outpoint2ByteString(genesisId),
    metadata.max,
  );

  const { tapScript, cblock } = script2P2TR(lockingScript);
  const { p2tr: nftP2TR } = getNFTContractP2TR(minterP2TR);

  const { protocolState: txState, states } = getMinterInitialTxState(
    nftP2TR,
    metadata.max,
  );

  const revealTx = new btc.Transaction()
    .from([
      {
        txId: commitTx.id,
        outputIndex: 0,
        script: commitTx.outputs[0].script,
        satoshis: commitTx.outputs[0].satoshis,
      },
      {
        txId: commitTx.id,
        outputIndex: 1,
        script: commitTx.outputs[1].script,
        satoshis: commitTx.outputs[1].satoshis,
      },
    ])
    .addOutput(
      new btc.Transaction.Output({
        satoshis: 0,
        script: toStateScript(txState),
      }),
    );

  for (let i = 0; i < states.length; i++) {
    revealTx.addOutput(
      new btc.Transaction.Output({
        satoshis: Postage.MINTER_POSTAGE,
        script: minterP2TR,
      }),
    );
  }

  revealTx.feePerByte(feeRate);

  const witnesses: Buffer[] = [];

  const { sighash } = getSHPreimage(revealTx, 0, Buffer.from(tapScript, 'hex'));

  const sig = btc.crypto.Schnorr.sign(
    wallet.getTaprootPrivateKey(),
    sighash.hash,
  );

  for (let i = 0; i < txState.stateHashList.length; i++) {
    const txoStateHash = txState.stateHashList[i];
    witnesses.push(Buffer.from(txoStateHash, 'hex'));
  }
  witnesses.push(sig);
  witnesses.push(lockingScript);
  witnesses.push(Buffer.from(cblock, 'hex'));

  const interpreter = new btc.Script.Interpreter();
  const flags =
    btc.Script.Interpreter.SCRIPT_VERIFY_WITNESS |
    btc.Script.Interpreter.SCRIPT_VERIFY_TAPROOT;

  const res = interpreter.verify(
    new btc.Script(''),
    commitTx.outputs[0].script,
    revealTx,
    0,
    flags,
    witnesses,
    commitTx.outputs[0].satoshis,
  );

  if (!res) {
    console.error('reveal faild!', interpreter.errstr);
    return;
  }

  revealTx.inputs[0].witnesses = witnesses;

  wallet.signTx(revealTx);
  return revealTx;
};

export async function deploy(
  metadata: CollectionMetadata,
  feeRate: number,
  utxos: UTXO[],
  wallet: WalletService,
  config: ConfigService,
  icon?: {
    type: string;
    body: string;
  },
): Promise<
  | {
      revealTx: btc.Transaction;
      genesisTx: btc.Transaction;
      tokenId: string;
      tokenAddr: string;
      minterAddr: string;
    }
  | undefined
> {
  const changeAddress: btc.Address = wallet.getAddress();

  const pubkeyX = wallet.getXOnlyPublicKey();
  const commitScript = getCatCollectionCommitScript(pubkeyX, metadata, icon);

  const lockingScript = Buffer.from(commitScript, 'hex');
  const { p2tr: p2tr } = script2P2TR(lockingScript);

  const changeScript = btc.Script.fromAddress(changeAddress);

  const commitTx = new btc.Transaction()
    .from(utxos)
    .addOutput(
      new btc.Transaction.Output({
        satoshis: Postage.METADATA_POSTAGE,
        script: p2tr,
      }),
    )
    .addOutput(
      /** utxo to pay revealTx fee */
      new btc.Transaction.Output({
        satoshis: 0,
        script: changeScript,
      }),
    )
    .feePerByte(feeRate)
    .change(changeAddress);

  if (commitTx.getChangeOutput() === null) {
    throw new Error('Insufficient satoshi balance!');
  }

  const dummyGenesisId = `${'0000000000000000000000000000000000000000000000000000000000000000'}_0`;

  const revealTxDummy = buildRevealTx(
    wallet,
    dummyGenesisId,
    lockingScript,
    metadata,
    commitTx,
    feeRate,
  );

  const revealTxFee =
    revealTxDummy.vsize * feeRate +
    Postage.MINTER_POSTAGE * (revealTxDummy.outputs.length - 1);

  commitTx.outputs[1].satoshis = revealTxFee;

  commitTx.change(changeAddress);

  if (commitTx.getChangeOutput() !== null) {
    commitTx.getChangeOutput().satoshis -= 1;
  }

  wallet.signTx(commitTx);

  const genesisId = `${commitTx.id}_0`;

  const revealTx = buildRevealTx(
    wallet,
    genesisId,
    lockingScript,
    metadata,
    commitTx,
    feeRate,
  );

  const { p2tr: minterP2TR } = getMinter(
    wallet,
    outpoint2ByteString(genesisId),
    metadata.max,
  );
  const { p2tr: tokenP2TR } = getNFTContractP2TR(minterP2TR);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const commitTxId = await broadcast(
    config,
    wallet,
    commitTx.uncheckedSerialize(),
  );

  if (commitTxId instanceof Error) {
    logerror(`commit failed!`, commitTxId);
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const revealTxId = await broadcast(
    config,
    wallet,
    revealTx.uncheckedSerialize(),
  );

  if (revealTxId instanceof Error) {
    logerror(`reveal failed!`, revealTxId);
    return null;
  }

  return {
    tokenId: genesisId,
    tokenAddr: p2tr2Address(tokenP2TR, config.getNetwork()),
    minterAddr: p2tr2Address(minterP2TR, config.getNetwork()),
    genesisTx: commitTx,
    revealTx: revealTx,
  };
}
