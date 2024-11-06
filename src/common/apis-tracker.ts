import {
  NftClosedMinterState,
  NftOpenMinterMerkleTreeData,
  NftOpenMinterState,
  NftParallelClosedMinterState,
  ProtocolState,
  ProtocolStateList,
} from '@cat-protocol/cat-smartcontracts';
import {
  NFTClosedMinterContract,
  NFTContract,
  NFTOpenMinterContract,
  NFTParallelClosedMinterContract,
} from './contact';
import { CollectionInfo } from './metadata';
import {
  isNFTClosedMinter,
  isNFTOpenMinter,
  isNFTParallelClosedMinter,
} from './minterFinder';
import { getNFTContractP2TR, p2tr2Address, script2P2TR, toP2tr } from './utils';
import { logerror } from './log';
import { ConfigService, SpendService } from 'src/providers';
import fetch from 'node-fetch-cjs';
import { getRawTransaction } from './apis';
import { btc } from './btc';
import { byteString2Int } from 'scrypt-ts';
import { updateMerkleTree } from 'src/commands/mint/nft.open-mint';
import { getMinterInitialTxState as getClosedMinterInitialTxState } from 'src/commands/deploy/nft.closed-mint';
import { getMinterInitialTxState as getParallelClosedMinterInitialTxState } from 'src/commands/deploy/nft.parallel-closed-mint';

export type ContractJSON = {
  utxo: {
    txId: string;
    outputIndex: number;
    script: string;
    satoshis: number;
  };
  txoStateHashes: Array<string>;
  state: any;
};

export type BalanceJSON = {
  blockHeight: number;
  balances: Array<{
    tokenId: string;
    confirmed: string;
  }>;
};

export const getCollectionInfo = async function (
  config: ConfigService,
  id: string,
): Promise<CollectionInfo | null> {
  const url = `${config.getTracker()}/api/collections/${id}`;
  return fetch(url, config.withProxy())
    .then((res) => res.json())
    .then((res: any) => {
      if (res.code === 0) {
        if (res.data === null) {
          return null;
        }
        const collection = res.data;
        if (collection.metadata.max) {
          // convert string to  bigint
          collection.metadata.max = BigInt(collection.metadata.max);
        }

        if (collection.metadata.premine) {
          // convert string to  bigint
          collection.metadata.premine = BigInt(collection.metadata.premine);
        }

        if (!collection.collectionAddr) {
          const minterP2TR = toP2tr(collection.minterAddr);
          const network = config.getNetwork();
          collection.collectionAddr = p2tr2Address(
            getNFTContractP2TR(minterP2TR).p2tr,
            network,
          );
        }
        return collection;
      } else {
        throw new Error(res.msg);
      }
    })
    .catch((e) => {
      logerror(`get collection info failed!`, e);
      return null;
    });
};

const fetchNftClosedMinterState = async function (
  config: ConfigService,
  collectionInfo: CollectionInfo,
  txId: string,
  vout: number,
): Promise<NftClosedMinterState | null> {
  const minterP2TR = toP2tr(collectionInfo.minterAddr);
  const nftP2TR = toP2tr(collectionInfo.collectionAddr);
  if (txId === collectionInfo.revealTxid) {
    const { states } = getClosedMinterInitialTxState(
      nftP2TR,
      collectionInfo.metadata.max,
    );
    return states[vout - 1];
  }

  const txhex = await getRawTransaction(config, txId);
  if (txhex instanceof Error) {
    logerror(`get raw transaction ${txId} failed!`, txhex);
    return null;
  }

  const tx = new btc.Transaction(txhex);

  const QUOTAMAXLOCALID_WITNESS_INDEX = 13;
  const NEXTLOCALID_WITNESS_INDEX = 6;

  for (let i = 0; i < tx.inputs.length; i++) {
    const witnesses = tx.inputs[i].getWitnesses();

    if (witnesses.length > 2) {
      const lockingScriptBuffer = witnesses[witnesses.length - 2];
      const { p2tr } = script2P2TR(lockingScriptBuffer);
      if (p2tr === minterP2TR) {
        const quotaMaxLocalId = byteString2Int(
          witnesses[QUOTAMAXLOCALID_WITNESS_INDEX].toString('hex'),
        );

        const nextLocalId =
          byteString2Int(witnesses[NEXTLOCALID_WITNESS_INDEX].toString('hex')) +
          1n;
        const preState: NftClosedMinterState = {
          nftScript: nftP2TR,
          quotaMaxLocalId,
          nextLocalId,
        };
        return preState;
      }
    }
  }

  return null;
};

const fetchNftParallelClosedMinterState = async function (
  config: ConfigService,
  collectionInfo: CollectionInfo,
  txId: string,
  vout: number = 1,
): Promise<NftParallelClosedMinterState | null> {
  const minterP2TR = toP2tr(collectionInfo.minterAddr);
  const nftP2TR = toP2tr(collectionInfo.collectionAddr);
  if (txId === collectionInfo.revealTxid) {
    const { states } = getParallelClosedMinterInitialTxState(nftP2TR);
    return states[0];
  }

  const txhex = await getRawTransaction(config, txId);
  if (txhex instanceof Error) {
    logerror(`get raw transaction ${txId} failed!`, txhex);
    return null;
  }

  const tx = new btc.Transaction(txhex);

  const NEXTLOCALID_WITNESS_INDEX = 6;

  for (let i = 0; i < tx.inputs.length; i++) {
    const witnesses = tx.inputs[i].getWitnesses();

    if (witnesses.length > 2) {
      const lockingScriptBuffer = witnesses[witnesses.length - 2];
      const { p2tr } = script2P2TR(lockingScriptBuffer);
      if (p2tr === minterP2TR) {
        const nextLocalId =
          byteString2Int(witnesses[NEXTLOCALID_WITNESS_INDEX].toString('hex')) *
            2n +
          BigInt(vout);
        const preState: NftParallelClosedMinterState = {
          nftScript: nftP2TR,
          nextLocalId,
        };
        return preState;
      }
    }
  }

  return null;
};

export const getNFTMinter = async function (
  config: ConfigService,
  collectionInfo: CollectionInfo,
  spendSerivce: SpendService,
  collectionMerkleTree?: NftOpenMinterMerkleTreeData,
): Promise<
  | NFTClosedMinterContract
  | NFTOpenMinterContract
  | NFTParallelClosedMinterContract
  | null
> {
  const url = `${config.getTracker()}/api/minters/${collectionInfo.collectionId}/utxos?limit=100&offset=${0}`;
  return fetch(url, config.withProxy())
    .then((res) => res.json())
    .then((res: any) => {
      if (res.code === 0) {
        return res.data;
      } else {
        throw new Error(res.msg);
      }
    })
    .then(({ utxos: contracts }) => {
      return Promise.all(
        contracts
          .filter((c) => spendSerivce.isUnspent(c.utxo))
          .map(async (c) => {
            const protocolState = ProtocolState.fromStateHashList(
              c.txoStateHashes as ProtocolStateList,
            );

            if (typeof c.utxo.satoshis === 'string') {
              c.utxo.satoshis = parseInt(c.utxo.satoshis);
            }

            let data: any = null;

            if (isNFTClosedMinter(collectionInfo.metadata.minterMd5)) {
              data = await fetchNftClosedMinterState(
                config,
                collectionInfo,
                c.utxo.txId,
                c.utxo.outputIndex,
              );
            } else if (
              isNFTParallelClosedMinter(collectionInfo.metadata.minterMd5)
            ) {
              data = await fetchNftParallelClosedMinterState(
                config,
                collectionInfo,
                c.utxo.txId,
                c.utxo.outputIndex,
              );
            } else if (isNFTOpenMinter(collectionInfo.metadata.minterMd5)) {
              data = await fetchNftOpenMinterState(
                config,
                collectionInfo,
                c.utxo.txId,
                collectionMerkleTree,
              );
            } else {
              throw new Error('Unkown minter!');
            }

            return {
              utxo: c.utxo,
              state: {
                protocolState,
                data,
              },
            };
          }),
      );
    })
    .then((minters) => {
      return minters[0] || null;
    })
    .catch((e) => {
      logerror(`fetch minters failed, minter: ${collectionInfo.minterAddr}`, e);
      return null;
    });
};

const fetchNftOpenMinterState = async function (
  config: ConfigService,
  collectionInfo: CollectionInfo,
  txId: string,
  collectionMerkleTree: NftOpenMinterMerkleTreeData,
): Promise<NftOpenMinterState | null> {
  const minterP2TR = toP2tr(collectionInfo.minterAddr);
  const tokenP2TR = toP2tr(collectionInfo.collectionAddr);
  const metadata = collectionInfo.metadata;
  if (txId === collectionInfo.revealTxid) {
    return {
      merkleRoot: collectionMerkleTree.merkleRoot,
      nextLocalId: 0n,
      nftScript: tokenP2TR,
    };
  }

  const txhex = await getRawTransaction(config, txId);
  if (txhex instanceof Error) {
    logerror(`get raw transaction ${txId} failed!`, txhex);
    return null;
  }

  const tx = new btc.Transaction(txhex);

  const NEXTLOCALID_WITNESS_INDEX = 6;

  for (let i = 0; i < tx.inputs.length; i++) {
    const witnesses = tx.inputs[i].getWitnesses();

    if (witnesses.length > 2) {
      const lockingScriptBuffer = witnesses[witnesses.length - 2];
      const { p2tr } = script2P2TR(lockingScriptBuffer);
      if (p2tr === minterP2TR) {
        const nextLocalId =
          byteString2Int(witnesses[NEXTLOCALID_WITNESS_INDEX].toString('hex')) +
          1n;
        updateMerkleTree(collectionMerkleTree, metadata.max, nextLocalId);
        const preState: NftOpenMinterState = {
          merkleRoot: collectionMerkleTree.merkleRoot,
          nftScript: tokenP2TR,
          nextLocalId: nextLocalId,
        };

        return preState;
      }
    }
  }

  return null;
};

export const getTrackerStatus = async function (config: ConfigService): Promise<
  | {
      trackerBlockHeight: number;
      nodeBlockHeight: number;
      latestBlockHeight: number;
    }
  | Error
> {
  const url = `${config.getTracker()}/api`;
  return fetch(url, config.withProxy())
    .then((res) => res.json())
    .then((res: any) => {
      if (res.code === 0) {
        return res.data;
      } else {
        throw new Error(res.msg);
      }
    })
    .catch((e) => {
      logerror(`fetch tracker status failed`, e);
      return e;
    });
};

export const getNft = async function (
  config: ConfigService,
  collection: CollectionInfo,
  localId: bigint,
): Promise<NFTContract | null> {
  const url = `${config.getTracker()}/api/collections/${collection.collectionId}/localId/${localId}/utxo`;
  return fetch(url, config.withProxy())
    .then((res) => res.json())
    .then((res: any) => {
      if (res.code === 0) {
        return res.data;
      } else {
        throw new Error(res.msg);
      }
    })
    .then(({ utxo: data }) => {
      if (!data) {
        return null;
      }
      const protocolState = ProtocolState.fromStateHashList(
        data.txoStateHashes as ProtocolStateList,
      );

      if (typeof data.utxo.satoshis === 'string') {
        data.utxo.satoshis = parseInt(data.utxo.satoshis);
      }

      const r: NFTContract = {
        utxo: data.utxo,
        state: {
          protocolState,
          data: {
            ownerAddr: data.state.address,
            localId: BigInt(data.state.localId),
          },
        },
      };

      return r;
    })
    .catch((e) => {
      logerror(`fetch NFTContract failed:`, e);
      return null;
    });
};

export const getNfts = async function (
  config: ConfigService,
  collection: CollectionInfo,
  ownerAddress: string,
  spendService: SpendService | null = null,
): Promise<{
  trackerBlockHeight: number;
  contracts: Array<NFTContract>;
} | null> {
  const url = `${config.getTracker()}/api/collections/${collection.collectionId}/addresses/${ownerAddress}/utxos`;
  return fetch(url, config.withProxy())
    .then((res) => res.json())
    .then((res: any) => {
      if (res.code === 0) {
        return res.data;
      } else {
        throw new Error(res.msg);
      }
    })
    .then(({ utxos, trackerBlockHeight }) => {
      let contracts: Array<NFTContract> = utxos.map((c) => {
        const protocolState = ProtocolState.fromStateHashList(
          c.txoStateHashes as ProtocolStateList,
        );

        if (typeof c.utxo.satoshis === 'string') {
          c.utxo.satoshis = parseInt(c.utxo.satoshis);
        }

        const r: NFTContract = {
          utxo: c.utxo,
          state: {
            protocolState,
            data: {
              ownerAddr: c.state.address,
              localId: BigInt(c.state.localId),
            },
          },
        };

        return r;
      });

      if (spendService) {
        contracts = contracts.filter((tokenContract) => {
          return spendService.isUnspent(tokenContract.utxo);
        });

        if (trackerBlockHeight - spendService.blockHeight() > 100) {
          spendService.reset();
        }
        spendService.updateBlockHeight(trackerBlockHeight);
      }

      return {
        contracts,
        trackerBlockHeight: trackerBlockHeight as number,
      };
    })
    .catch((e) => {
      logerror(`fetch tokens failed:`, e);
      return null;
    });
};

export const getCollectionsByOwner = async function (
  config: ConfigService,
  ownerAddress: string,
): Promise<Array<string>> {
  const url = `${config.getTracker()}/api/addresses/${ownerAddress}/collections`;
  return fetch(url, config.withProxy())
    .then((res) => res.json())
    .then((res: any) => {
      if (res.code === 0) {
        return res.data;
      } else {
        throw new Error(res.msg);
      }
    })
    .then(({ collections }) => {
      return collections.map((collection) => {
        return collection.collectionId;
      });
    })
    .catch((e) => {
      logerror(`fetch collections failed:`, e);
      return [];
    });
};
