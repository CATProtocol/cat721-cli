import {
  addrToP2trLockingScript,
  btc,
  Cat721Metadata,
  Cat721MinterUtxo,
  Cat721NftInfo,
  Cat721Utxo,
  ChainProvider,
  NftParallelClosedMinterProto,
  NftParallelClosedMinterState,
  p2trLockingScriptToAddr,
  ProtocolState,
  scriptToP2tr,
} from '@cat-protocol/cat-sdk';
import { isNFTParallelClosedMinter } from './minterFinder';
import { getNFTContractP2TR } from './utils';
import { logerror } from './log';
import { ConfigService, SpendService } from 'src/providers';
import fetch from 'cross-fetch';
import { byteString2Int } from 'scrypt-ts';

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
): Promise<Cat721NftInfo<Cat721Metadata> | null> {
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
          const minterP2TR = addrToP2trLockingScript(collection.minterAddr);
          const network = config.getNetwork();
          collection.collectionAddr = p2trLockingScriptToAddr(
            getNFTContractP2TR(minterP2TR),
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

export function getParallelClosedMinterInitialTxState(nftP2TR: string): {
  protocolState: ProtocolState;
  states: NftParallelClosedMinterState[];
} {
  const protocolState = ProtocolState.getEmptyState();

  const states: NftParallelClosedMinterState[] = [];

  const state = NftParallelClosedMinterProto.create(nftP2TR, 0n);
  const outputState = NftParallelClosedMinterProto.toByteString(state);
  protocolState.updateDataList(0, outputState);
  states.push(state);

  return {
    protocolState,
    states,
  };
}

const fetchNftParallelClosedMinterState = async function (
  chainProvider: ChainProvider,
  collectionInfo: Cat721NftInfo<Cat721Metadata>,
  txId: string,
  vout: number = 1,
): Promise<NftParallelClosedMinterState | null> {
  const minterP2TR = addrToP2trLockingScript(collectionInfo.minterAddr);
  const nftP2TR = addrToP2trLockingScript(collectionInfo.collectionAddr);
  if (txId === collectionInfo.revealTxid) {
    const { states } = getParallelClosedMinterInitialTxState(nftP2TR);
    return states[0];
  }

  const txhex = await chainProvider.getRawTransaction(txId);

  const tx = new btc.Transaction(txhex);

  const NEXTLOCALID_WITNESS_INDEX = 6;

  for (let i = 0; i < tx.inputs.length; i++) {
    const witnesses = tx.inputs[i].getWitnesses();

    if (witnesses.length > 2) {
      const lockingScriptBuffer = witnesses[witnesses.length - 2];
      const { p2trLockingScript: p2tr } = scriptToP2tr(lockingScriptBuffer);
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
  chainProvider: ChainProvider,
  collectionInfo: Cat721NftInfo<Cat721Metadata>,
  spendSerivce: SpendService,
): Promise<Cat721MinterUtxo | null> {
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
    .then(({ utxos }) => {
      return Promise.all(
        utxos
          .filter((utxoData) => spendSerivce.isUnspent(utxoData.utxo))
          .map(async (utxoData) => {
            if (typeof utxoData.utxo.satoshis === 'string') {
              utxoData.utxo.satoshis = parseInt(utxoData.utxo.satoshis);
            }

            let data: any = null;

            if (isNFTParallelClosedMinter(collectionInfo.metadata.minterMd5)) {
              data = await fetchNftParallelClosedMinterState(
                chainProvider,
                collectionInfo,
                utxoData.utxo.txId,
                utxoData.utxo.outputIndex,
              );
            } else {
              throw new Error('Unkown minter!');
            }

            const minterUtxo: Cat721MinterUtxo = {
              utxo: utxoData.utxo,
              txoStateHashes: utxoData.txoStateHashes,
              state: data,
            };
            return minterUtxo;
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
  collection: Cat721NftInfo<Cat721Metadata>,
  localId: bigint,
): Promise<Cat721Utxo | null> {
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
      if (typeof data.utxo.satoshis === 'string') {
        data.utxo.satoshis = parseInt(data.utxo.satoshis);
      }

      const cat721Utxo: Cat721Utxo = {
        utxo: data.utxo,
        txoStateHashes: data.txoStateHashes,
        state: {
          ownerAddr: data.state.address,
          localId: BigInt(data.state.localId),
        },
      };

      return cat721Utxo;
    })
    .catch((e) => {
      logerror(`fetch NFTContract failed:`, e);
      return null;
    });
};

export const getNfts = async function (
  config: ConfigService,
  collection: Cat721NftInfo<Cat721Metadata>,
  ownerAddress: string,
  spendService: SpendService | null = null,
): Promise<Array<Cat721Utxo>> {
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
      let cat721Utxos: Array<Cat721Utxo> = utxos.map((c) => {
        if (typeof c.utxo.satoshis === 'string') {
          c.utxo.satoshis = parseInt(c.utxo.satoshis);
        }

        const cat721Utxo: Cat721Utxo = {
          utxo: c.utxo,
          txoStateHashes: c.txoStateHashes,
          state: {
            ownerAddr: c.state.address,
            localId: BigInt(c.state.localId),
          },
        };

        return cat721Utxo;
      });

      if (spendService) {
        cat721Utxos = cat721Utxos.filter((cat721Utxo) => {
          return spendService.isUnspent(cat721Utxo.utxo);
        });

        if (trackerBlockHeight - spendService.blockHeight() > 100) {
          spendService.reset();
        }
        spendService.updateBlockHeight(trackerBlockHeight);
      }

      return cat721Utxos;
    })
    .catch((e) => {
      logerror(`fetch cat721Utxos failed:`, e);
      return [];
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
