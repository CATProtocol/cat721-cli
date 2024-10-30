import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  CollectionInfo,
  CollectionMetadata,
  getCollectionInfo,
  logerror,
} from 'src/common';
import { ConfigService } from 'src/providers';

export function getAllCollectionInfos(config: ConfigService): CollectionInfo[] {
  const path = getCollectionInfoPath(config);

  try {
    if (existsSync(path)) {
      const bigintKeys = ['max', 'premine'];
      const collectionInfos = JSON.parse(
        readFileSync(path).toString(),
        (key, value) => {
          if (bigintKeys.includes(key)) {
            return BigInt(value);
          }
          return value;
        },
      ) as Array<any>;
      return collectionInfos;
    } else {
      return [];
    }
  } catch (error) {
    logerror('getAllCollectionInfos failed!', error);
  }

  return [];
}

export async function findCollectionInfoById(
  config: ConfigService,
  id: string,
): Promise<CollectionInfo | null> {
  const collectionInfos = getAllCollectionInfos(config);
  let collectionInfo = collectionInfos.find(
    (collection) => collection.collectionId === id,
  );
  if (collectionInfo) {
    return collectionInfo;
  }

  collectionInfo = await getCollectionInfo(config, id);

  if (collectionInfo) {
    saveCollectionInfo(collectionInfo, config);
  }

  return collectionInfo;
}

function saveCollectionInfo(
  collectionInfo: CollectionInfo,
  config: ConfigService,
): CollectionInfo[] {
  const collectionInfos = getAllCollectionInfos(config);
  collectionInfos.push(collectionInfo);
  const path = getCollectionInfoPath(config);
  try {
    writeFileSync(path, JSON.stringify(collectionInfos, null, 1));
  } catch (error) {
    console.error('save token metadata error:', error);
  }

  return collectionInfos;
}

export function addCollectionInfo(
  config: ConfigService,
  tokenId: string,
  collectionMetadata: CollectionMetadata,
  tokenAddr: string,
  minterAddr: string,
  genesisTxid: string,
  revealTxid: string,
) {
  const collectionInfo: CollectionInfo = {
    metadata: collectionMetadata,
    collectionId: tokenId,
    collectionAddr: tokenAddr,
    minterAddr: minterAddr,
    genesisTxid,
    revealTxid,
    timestamp: new Date().getTime(),
  };
  saveCollectionInfo(collectionInfo, config);
  return collectionInfo;
}

export function getCollectionInfoPath(config: ConfigService) {
  return join(config.getDataDir(), 'collections.json');
}
