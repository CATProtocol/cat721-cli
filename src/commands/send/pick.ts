import { UTXO } from 'scrypt-ts';
import { NFTContract } from 'src/common';

export function pickLargeFeeUtxo(feeUtxos: Array<UTXO>): UTXO {
  let max = feeUtxos[0];

  for (const utxo of feeUtxos) {
    if (utxo.satoshis > max.satoshis) {
      max = utxo;
    }
  }
  return max;
}

export function pickBylocalId(
  contracts: Array<NFTContract>,
  localId: bigint,
): NFTContract | undefined {
  return contracts.find((contract) => contract.state.data.localId === localId);
}
