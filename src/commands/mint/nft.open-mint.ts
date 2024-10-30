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
  NFTOpenMinterContract,
  getNftOpenMinterContractP2TR,
  script2P2TR,
  log,
} from 'src/common';

import {
  getBackTraceInfo,
  OpenMinter,
  ProtocolState,
  PreTxStatesInfo,
  ChangeInfo,
  NftOpenMinterProto,
  NftOpenMinterState,
  CAT721State,
  CAT721Proto,
  NftOpenMinterMerkleTreeData,
  NftMerkleLeaf,
  NftOpenMinter,
  int32,
  getTxCtxMulti,
} from '@cat-protocol/cat-smartcontracts';
import { ConfigService, SpendService, WalletService } from 'src/providers';
import { createNft, unlockNFT } from './nft';

const calcVsize = async (
  wallet: WalletService,
  minter: SmartContract,
  newState: ProtocolState,
  tokenMint: CAT721State,
  leafInfo: any,
  preTxState: PreTxStatesInfo,
  preState: NftOpenMinterState,
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
    leafInfo.neighbor,
    leafInfo.neighborType,
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
    } as MethodCallOptions<OpenMinter>,
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

const getPremineAddress = async (
  config: ConfigService,
  utxo: UTXO,
): Promise<string | Error> => {
  const txhex = await getRawTransaction(config, utxo.txId);
  if (txhex instanceof Error) {
    logerror(`get raw transaction ${utxo.txId} failed!`, txhex);
    return txhex;
  }
  try {
    const tx = new btc.Transaction(txhex);
    const witnesses: Buffer[] = tx.inputs[0].getWitnesses();
    const lockingScript = witnesses[witnesses.length - 2];
    try {
      const minter = NftOpenMinter.fromLockingScript(
        lockingScript.toString('hex'),
      ) as NftOpenMinter;
      return minter.premineAddr;
    } catch (e) {}
    const minter = NftOpenMinter.fromLockingScript(
      lockingScript.toString('hex'),
    ) as NftOpenMinter;
    return minter.premineAddr;
  } catch (error) {
    return error;
  }
};

export async function openMint(
  config: ConfigService,
  wallet: WalletService,
  spendService: SpendService,
  feeRate: number,
  feeUtxos: UTXO[],
  collectionInfo: CollectionInfo,
  minterContract: NFTOpenMinterContract,
  nftOpenMinterMerkleTreeData: NftOpenMinterMerkleTreeData,
  contentType: string,
  contentBody: string,
  nftmetadata: object,
  owner?: string,
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

  const newNextLocalId = preState.nextLocalId + 1n;

  const oldLeaf = nftOpenMinterMerkleTreeData.getLeaf(
    Number(preState.nextLocalId),
  );
  const newLeaf: NftMerkleLeaf = {
    commitScript: oldLeaf.commitScript,
    localId: oldLeaf.localId,
    isMined: true,
  };
  nftOpenMinterMerkleTreeData.updateLeaf(newLeaf, Number(preState.nextLocalId));
  const tokenState = CAT721Proto.create(owner, preState.nextLocalId);

  if (newNextLocalId < collectionInfo.metadata.max) {
    const minterState = NftOpenMinterProto.create(
      tokenP2TR,
      nftOpenMinterMerkleTreeData.merkleRoot,
      newNextLocalId,
    );
    newState.updateDataList(0, NftOpenMinterProto.toByteString(minterState));
    newState.updateDataList(1, CAT721Proto.toByteString(tokenState));
  } else {
    newState.updateDataList(0, CAT721Proto.toByteString(tokenState));
  }

  let premineAddress = '';

  if (collectionInfo.metadata.premine > 0n) {
    if (preState.nextLocalId === 0n) {
      premineAddress = wallet.getTokenAddress();
    } else {
      const address = await getPremineAddress(config, minterContract.utxo);

      if (address instanceof Error) {
        logerror(`get premine address failed!`, address);
        return address;
      }

      premineAddress = address;
    }
  }

  const {
    tapScript: minterTapScript,
    cblock: cblockMinter,
    contract: minter,
  } = getNftOpenMinterContractP2TR(
    genesisId,
    collectionInfo.metadata.max,
    collectionInfo.metadata.premine || 0n,
    premineAddress,
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

  if (newNextLocalId < collectionInfo.metadata.max) {
    revealTx.addOutput(
      new btc.Transaction.Output({
        script: new btc.Script(minterUtxo.script),
        satoshis: Postage.MINTER_POSTAGE,
      }),
    );
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

  const leafInfo = nftOpenMinterMerkleTreeData.getMerklePath(
    Number(preState.nextLocalId),
  );

  const vsize: number = await calcVsize(
    wallet,
    minter,
    newState,
    tokenState,
    leafInfo,
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
    Postage.MINTER_POSTAGE *
      (newNextLocalId < collectionInfo.metadata.max ? 1 : 0) -
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
    leafInfo.neighbor,
    leafInfo.neighborType,
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
    } as MethodCallOptions<OpenMinter>,
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

export function updateMerkleTree(
  collectionMerkleTree: NftOpenMinterMerkleTreeData,
  max: int32,
  nextLocalId: int32,
) {
  for (let i = 0n; i < max; i++) {
    if (i < nextLocalId) {
      const oldLeaf = collectionMerkleTree.getLeaf(Number(i));
      const newLeaf: NftMerkleLeaf = {
        commitScript: oldLeaf.commitScript,
        localId: oldLeaf.localId,
        isMined: true,
      };
      collectionMerkleTree.updateLeaf(newLeaf, Number(i));
    }
  }
}
