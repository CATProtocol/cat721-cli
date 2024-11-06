import { MinterType } from './minter';

export function isOpenMinter(md5: string) {
  return MinterType.OPEN_MINTER_V1 === md5 || MinterType.OPEN_MINTER_V2 === md5;
}

export function isNFTClosedMinter(md5: string) {
  return MinterType.NFT_CLOSED_MINTER === md5;
}

export function isNFTParallelClosedMinter(md5: string) {
  return MinterType.NFT_PARALLEL_CLOSED_MINTER === md5;
}

export function isNFTOpenMinter(md5: string) {
  return MinterType.NFT_OPEN_MINTER === md5;
}
