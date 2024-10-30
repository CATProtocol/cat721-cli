export interface CollectionMetadata {
  name: string;
  symbol: string;
  description: string;
  max: bigint;
  premine?: bigint;
  icon?: string;
  minterMd5: string;
}

export interface CollectionInfo {
  metadata: CollectionMetadata;
  collectionId: string;
  /** token p2tr address */
  collectionAddr: string;
  /** minter p2tr address */
  minterAddr: string;
  genesisTxid: string;
  revealTxid: string;
  timestamp: number;
}
