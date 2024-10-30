import {
  ProtocolState,
  OpenMinterState,
  CAT20State,
  GuardConstState,
  CAT721State,
  NftClosedMinterState,
  NftGuardConstState,
  OpenMinterV2State,
  NftOpenMinterState,
} from '@cat-protocol/cat-smartcontracts';
import { UTXO } from 'scrypt-ts';

export interface ContractState<T> {
  protocolState: ProtocolState;

  data: T;
}

export interface Contract<T> {
  utxo: UTXO;
  state: ContractState<T>;
}

export type OpenMinterContract = Contract<OpenMinterState | OpenMinterV2State>;

export type TokenContract = Contract<CAT20State>;

export type GuardContract = Contract<GuardConstState>;

export type NFTClosedMinterContract = Contract<NftClosedMinterState>;

export type NFTOpenMinterContract = Contract<NftOpenMinterState>;

export type NFTContract = Contract<CAT721State>;

export type NFTGuardContract = Contract<NftGuardConstState>;
