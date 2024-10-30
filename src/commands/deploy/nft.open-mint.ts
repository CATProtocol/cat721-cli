import { ByteString, UTXO } from 'scrypt-ts';
import {
  broadcast,
  script2P2TR,
  toStateScript,
  p2tr2Address,
  outpoint2ByteString,
  Postage,
  btc,
  logerror,
  CollectionMetadata,
  getNFTContractP2TR,
  getNftOpenMinterContractP2TR,
} from 'src/common';

import {
  ProtocolState,
  getSHPreimage,
  int32,
  NftOpenMinterProto,
  NftOpenMinterState,
  NftMerkleLeaf,
  getCatNFTCommitScript,
  HEIGHT,
  NftOpenMinterMerkleTreeData,
  getCatCollectionCommitScript,
} from '@cat-protocol/cat-smartcontracts';
import { ConfigService, WalletService } from 'src/providers';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';

function getMinter(
  wallet: WalletService,
  genesisId: string,
  max: int32,
  premine: int32,
) {
  const premineAddr = premine > 0n ? wallet.getTokenAddress() : '';
  return getNftOpenMinterContractP2TR(genesisId, max, premine, premineAddr);
}

function getMinterInitialTxState(
  tokenP2TR: string,
  merkleRoot: ByteString,
): {
  protocolState: ProtocolState;
  data: NftOpenMinterState;
} {
  const protocolState = ProtocolState.getEmptyState();
  const minterState = NftOpenMinterProto.create(tokenP2TR, merkleRoot, 0n);
  const outputState = NftOpenMinterProto.toByteString(minterState);
  protocolState.updateDataList(0, outputState);
  return {
    protocolState,
    data: minterState,
  };
}

const buildRevealTx = (
  wallet: WalletService,
  lockingScript: btc.Script,
  commitTx: btc.Transaction,
  minterP2TR: string,
  merkleRoot: ByteString,
  feeRate: number,
): btc.Transaction => {
  const { tapScript, cblock } = script2P2TR(lockingScript);
  const { p2tr: tokenP2TR } = getNFTContractP2TR(minterP2TR);

  const { protocolState: txState } = getMinterInitialTxState(
    tokenP2TR,
    merkleRoot,
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
    )
    .addOutput(
      new btc.Transaction.Output({
        satoshis: Postage.MINTER_POSTAGE,
        script: minterP2TR,
      }),
    )
    .feePerByte(feeRate);

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
  merkleRoot: ByteString,
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

  const { p2tr: dummyMinterP2TR } = getMinter(
    wallet,
    outpoint2ByteString(dummyGenesisId),
    metadata.max,
    metadata.premine || 0n,
  );

  const revealTxDummy = buildRevealTx(
    wallet,
    lockingScript,
    commitTx,
    dummyMinterP2TR,
    merkleRoot,
    feeRate,
  );

  const revealTxFee = revealTxDummy.vsize * feeRate + Postage.MINTER_POSTAGE;

  commitTx.outputs[1].satoshis = revealTxFee;

  commitTx.change(changeAddress);

  if (commitTx.getChangeOutput() === null) {
    throw new Error('Insufficient satoshi balance!');
  }

  commitTx.getChangeOutput().satoshis -= 1;

  wallet.signTx(commitTx);

  const genesisId = `${commitTx.id}_0`;

  const { p2tr: minterP2TR } = getMinter(
    wallet,
    outpoint2ByteString(genesisId),
    metadata.max,
    metadata.premine || 0n,
  );

  const revealTx = buildRevealTx(
    wallet,
    lockingScript,
    commitTx,
    minterP2TR,
    merkleRoot,
    feeRate,
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

const createMerkleLeaf = function (
  pubkeyX: string,
  localId: bigint,
  metadata: object,
  content: {
    type: string;
    body: string;
  },
): NftMerkleLeaf {
  const commitScript = getCatNFTCommitScript(pubkeyX, metadata, content);
  const lockingScript = Buffer.from(commitScript, 'hex');
  const { p2tr } = script2P2TR(lockingScript);
  return {
    commitScript: p2tr,
    localId: localId,
    isMined: false,
  };
};

export const generateCollectionMerkleTree = function (
  max: bigint,
  pubkeyX: string,
  type: string,
  resourceDir: string,
) {
  const nftMerkleLeafList: NftMerkleLeaf[] = [];

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_, ext] = type.split('/');
  if (!ext) {
    throw new Error(`unknow type: ${type}`);
  }
  for (let index = 0n; index < max; index++) {
    const body = readFileSync(join(resourceDir, `${index}.${ext}`)).toString(
      'hex',
    );

    const metadata = {
      localId: index,
    };

    try {
      const metadataFile = join(resourceDir, `${index}.json`);

      if (existsSync(metadataFile)) {
        const str = readFileSync(metadataFile).toString();
        const obj = JSON.parse(str);
        Object.assign(metadata, obj);
      }
    } catch (error) {
      logerror(`readMetaData FAIL, localId: ${index}`, error);
    }

    nftMerkleLeafList.push(
      createMerkleLeaf(pubkeyX, index, metadata, {
        type,
        body,
      }),
    );
  }

  return new NftOpenMinterMerkleTreeData(nftMerkleLeafList, HEIGHT);
};
