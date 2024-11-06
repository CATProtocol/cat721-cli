import {
  toByteString,
  UTXO,
  MethodCallOptions,
  int2ByteString,
  SmartContract,
} from 'scrypt-ts';
import {
  getRawTransaction,
  getDummySigner,
  getDummyUTXO,
  callToBufferList,
  broadcast,
  resetTx,
  toStateScript,
  outpoint2ByteString,
  Postage,
  toP2tr,
  logerror,
  btc,
  verifyContract,
  CollectionInfo,
  getNftParallelClosedMinterContractP2TR,
  script2P2TR,
  NFTParallelClosedMinterContract,
} from 'src/common';

import {
  getBackTraceInfo,
  ProtocolState,
  PreTxStatesInfo,
  ChangeInfo,
  NftParallelClosedMinterProto,
  NftParallelClosedMinterState,
  CAT721State,
  CAT721Proto,
  getTxCtxMulti,
  NftParallelClosedMinter,
} from '@cat-protocol/cat-smartcontracts';
import { ConfigService, SpendService, WalletService } from 'src/providers';
import { createNft, unlockNFT } from './nft';

const calcVsize = async (
  wallet: WalletService,
  minter: SmartContract,
  newState: ProtocolState,
  tokenMint: CAT721State,
  preTxState: PreTxStatesInfo,
  preState: NftParallelClosedMinterState,
  minterTapScript: string,
  nftTapScript: string,
  inputIndex: number,
  revealTx: btc.Transaction,
  commitTx: btc.Transaction,
  changeScript: btc.Script,
  nftCommitScript: btc.Script,
  backtraceInfo: any,
  cblockMinter: string,
  cblocknft: string,
) => {
  const txCtxs = getTxCtxMulti(
    revealTx,
    [0, 1],
    [Buffer.from(minterTapScript, 'hex'), Buffer.from(nftTapScript, 'hex')],
  );
  unlockNFT(wallet, commitTx, revealTx, nftCommitScript, cblocknft, txCtxs[1]);

  const { sighash, shPreimage, prevoutsCtx, spentScripts } = txCtxs[0];

  const changeInfo: ChangeInfo = {
    script: toByteString(changeScript.toHex()),
    satoshis: int2ByteString(BigInt(0n), 8n),
  };
  const sig = btc.crypto.Schnorr.sign(
    wallet.getTokenPrivateKey(),
    sighash.hash,
  );
  const minterCall = await minter.methods.mint(
    newState.stateHashList,
    tokenMint,
    wallet.getPubKeyPrefix(),
    wallet.getXOnlyPublicKey(),
    () => sig.toString('hex'),
    int2ByteString(BigInt(Postage.MINTER_POSTAGE), 8n),
    int2ByteString(BigInt(Postage.TOKEN_POSTAGE), 8n),
    preState,
    preTxState,
    backtraceInfo,
    shPreimage,
    prevoutsCtx,
    spentScripts,
    changeInfo,
    {
      fromUTXO: getDummyUTXO(),
      verify: false,
      exec: false,
    } as MethodCallOptions<NftParallelClosedMinter>,
  );
  const witnesses = [
    ...callToBufferList(minterCall),
    minter.lockingScript.toBuffer(),
    Buffer.from(cblockMinter, 'hex'),
  ];
  revealTx.inputs[inputIndex].witnesses = witnesses;
  wallet.signTx(revealTx);
  const vsize = revealTx.vsize;
  resetTx(revealTx);
  return vsize;
};

export async function parallelClosedMint(
  config: ConfigService,
  wallet: WalletService,
  spendService: SpendService,
  feeRate: number,
  feeUtxos: UTXO[],
  collectionInfo: CollectionInfo,
  minterContract: NFTParallelClosedMinterContract,
  contentType: string,
  contentBody: string,
  nftmetadata: object,
  owner: string = '',
): Promise<string | Error> {
  const {
    utxo: minterUtxo,
    state: { protocolState, data: preState },
  } = minterContract;

  const address = wallet.getAddress();

  owner = owner || wallet.getTokenAddress();

  const tokenP2TR = toP2tr(collectionInfo.collectionAddr);

  const { commitTx, feeUTXO, nftCommitScript } = createNft(
    wallet,
    feeRate,
    feeUtxos,
    address,
    contentType,
    contentBody,
    nftmetadata,
  );

  const genesisId = outpoint2ByteString(collectionInfo.collectionId);

  const newState = ProtocolState.getEmptyState();

  const max = collectionInfo.metadata.max;
  const newNextLocalId1 = preState.nextLocalId * 2n + 1n;
  const newNextLocalId2 = preState.nextLocalId * 2n + 2n;

  const minterStates: NftParallelClosedMinterState[] = [];
  if (newNextLocalId1 < max) {
    const minterState = NftParallelClosedMinterProto.create(
      tokenP2TR,
      newNextLocalId1,
    );
    minterStates.push(minterState);
    newState.updateDataList(
      0,
      NftParallelClosedMinterProto.toByteString(minterState),
    );
  }

  if (newNextLocalId2 < max) {
    const minterState = NftParallelClosedMinterProto.create(
      tokenP2TR,
      newNextLocalId2,
    );
    minterStates.push(minterState);
    newState.updateDataList(
      1,
      NftParallelClosedMinterProto.toByteString(minterState),
    );
  }

  const tokenState = CAT721Proto.create(owner, preState.nextLocalId);
  newState.updateDataList(
    minterStates.length,
    CAT721Proto.toByteString(tokenState),
  );

  const issuerAddress = wallet.getTokenAddress();
  const {
    tapScript: minterTapScript,
    cblock: cblockMinter,
    contract: minter,
  } = getNftParallelClosedMinterContractP2TR(
    issuerAddress,
    genesisId,
    collectionInfo.metadata.max,
  );

  const { tapScript: nftTapScript, cblock: cblockNft } =
    script2P2TR(nftCommitScript);

  const changeScript = btc.Script.fromAddress(address);

  const nftUTXO: UTXO = {
    txId: commitTx.id,
    outputIndex: 0,
    satoshis: commitTx.outputs[0].satoshis,
    script: commitTx.outputs[0].script.toHex(),
  };

  const revealTx = new btc.Transaction()
    .from([minterUtxo, nftUTXO, feeUTXO])
    .addOutput(
      new btc.Transaction.Output({
        satoshis: 0,
        script: toStateScript(newState),
      }),
    );

  if (minterStates.length > 0) {
    for (let i = 0; i < minterStates.length; i++) {
      revealTx.addOutput(
        new btc.Transaction.Output({
          script: new btc.Script(minterUtxo.script),
          satoshis: Postage.MINTER_POSTAGE,
        }),
      );
    }
  }

  revealTx
    .addOutput(
      new btc.Transaction.Output({
        satoshis: Postage.TOKEN_POSTAGE,
        script: tokenP2TR,
      }),
    )
    .addOutput(
      new btc.Transaction.Output({
        satoshis: 0,
        script: changeScript,
      }),
    )
    .feePerByte(feeRate);

  const minterInputIndex = 0;

  const prevTxHex = await getRawTransaction(config, minterUtxo.txId);
  if (prevTxHex instanceof Error) {
    logerror(`get raw transaction ${minterUtxo.txId} failed!`, prevTxHex);
    return prevTxHex;
  }

  const prevTx = new btc.Transaction(prevTxHex);

  const prevPrevTxId = prevTx.inputs[minterInputIndex].prevTxId.toString('hex');
  const prevPrevTxHex = await getRawTransaction(config, prevPrevTxId);
  if (prevPrevTxHex instanceof Error) {
    logerror(`get raw transaction ${prevPrevTxId} failed!`, prevPrevTxHex);
    return prevPrevTxHex;
  }

  const prevPrevTx = new btc.Transaction(prevPrevTxHex);

  const backtraceInfo = getBackTraceInfo(prevTx, prevPrevTx, minterInputIndex);

  await minter.connect(getDummySigner());

  const preTxState: PreTxStatesInfo = {
    statesHashRoot: protocolState.hashRoot,
    txoStateHashes: protocolState.stateHashList,
  };

  const vsize: number = await calcVsize(
    wallet,
    minter,
    newState,
    tokenState,
    preTxState,
    preState,
    minterTapScript,
    nftTapScript,
    minterInputIndex,
    revealTx,
    commitTx,
    changeScript,
    nftCommitScript,
    backtraceInfo,
    cblockMinter,
    cblockNft,
  );

  const changeAmount =
    revealTx.inputAmount -
    vsize * feeRate -
    Postage.MINTER_POSTAGE * minterStates.length -
    Postage.TOKEN_POSTAGE;

  if (changeAmount < 546) {
    const message = 'Insufficient satoshis balance!';
    return new Error(message);
  }

  // update change amount
  const changeOutputIndex = revealTx.outputs.length - 1;
  revealTx.outputs[changeOutputIndex].satoshis = changeAmount;

  const txCtxs = getTxCtxMulti(
    revealTx,
    [minterInputIndex, minterInputIndex + 1],
    [Buffer.from(minterTapScript, 'hex'), Buffer.from(nftTapScript, 'hex')],
  );

  const changeInfo: ChangeInfo = {
    script: toByteString(changeScript.toHex()),
    satoshis: int2ByteString(BigInt(changeAmount), 8n),
  };

  const { shPreimage, prevoutsCtx, spentScripts, sighash } =
    txCtxs[minterInputIndex];

  const sig = btc.crypto.Schnorr.sign(
    wallet.getTokenPrivateKey(),
    sighash.hash,
  );

  const minterCall = await minter.methods.mint(
    newState.stateHashList,
    tokenState,
    wallet.getPubKeyPrefix(),
    wallet.getXOnlyPublicKey(),
    () => sig.toString('hex'),
    int2ByteString(BigInt(Postage.MINTER_POSTAGE), 8n),
    int2ByteString(BigInt(Postage.TOKEN_POSTAGE), 8n),
    preState,
    preTxState,
    backtraceInfo,
    shPreimage,
    prevoutsCtx,
    spentScripts,
    changeInfo,
    {
      fromUTXO: getDummyUTXO(),
      verify: false,
      exec: false,
    } as MethodCallOptions<NftParallelClosedMinter>,
  );
  const witnesses = [
    ...callToBufferList(minterCall),
    minter.lockingScript.toBuffer(),
    Buffer.from(cblockMinter, 'hex'),
  ];
  revealTx.inputs[minterInputIndex].witnesses = witnesses;

  if (config.getVerify()) {
    const res = verifyContract(
      minterUtxo,
      revealTx,
      minterInputIndex,
      witnesses,
    );
    if (typeof res === 'string') {
      console.log('unlocking minter failed:', res);
      return new Error('unlocking minter failed');
    }
  }
  if (
    !unlockNFT(
      wallet,
      commitTx,
      revealTx,
      nftCommitScript,
      cblockNft,
      txCtxs[minterInputIndex + 1],
      config.getVerify(),
    )
  ) {
    return new Error('unlock NFT commit UTXO failed');
  }

  wallet.signTx(revealTx);

  let res = await broadcast(config, wallet, commitTx.uncheckedSerialize());

  if (res instanceof Error) {
    logerror('broadcast commit NFT tx failed!', res);
    return res;
  }

  console.log(
    `Commiting ${collectionInfo.metadata.symbol}:${minterContract.state.data.nextLocalId} NFT in txid: ${res}`,
  );
  spendService.updateSpends(commitTx);

  res = await broadcast(config, wallet, revealTx.uncheckedSerialize());

  if (res instanceof Error) {
    logerror('broadcast reveal NFT tx failed!', res);
    return res;
  }

  spendService.updateSpends(revealTx);

  return revealTx.id;
}
