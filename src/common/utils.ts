import { CAT721Covenant } from '@cat-protocol/cat-sdk';

export function getNFTContractP2TR(minterP2TR: string) {
  return new CAT721Covenant(minterP2TR).lockingScriptHex;
}

export function sleep(seconds: number) {
  return new Promise(function (resolve) {
    setTimeout(resolve, seconds * 1000);
  });
}

export function checkOpenMintMetadata(info: any): Error | null {
  if (typeof info.name === 'undefined') {
    return new Error(`No token name provided!`);
  }

  if (typeof info.name !== 'string') {
    return new Error(`Invalid token name!`);
  }

  if (typeof info.symbol === 'undefined') {
    return new Error(`No token symbol provided!`);
  }

  if (typeof info.symbol !== 'string') {
    return new Error(`Invalid token symbol!`);
  }

  if (typeof info.max === 'undefined') {
    return new Error(`No token max supply provided!`);
  }

  if (typeof info.max === 'string') {
    try {
      info.max = BigInt(info.max);
    } catch (error) {
      return error;
    }
  } else if (typeof info.max !== 'bigint') {
    return new Error(`Invalid token max supply!`);
  }

  if (typeof info.premine === 'string') {
    try {
      info.premine = BigInt(info.premine);
    } catch (error) {
      return error;
    }
  } else if (typeof info.premine !== 'bigint') {
    return new Error(`Invalid token premine!`);
  }
}

export function checkClosedMintMetadata(info: any): Error | null {
  if (typeof info.name === 'undefined') {
    return new Error(`No token name provided!`);
  }

  if (typeof info.name !== 'string') {
    return new Error(`Invalid token name!`);
  }

  if (typeof info.symbol === 'undefined') {
    return new Error(`No token symbol provided!`);
  }

  if (typeof info.symbol !== 'string') {
    return new Error(`Invalid token symbol!`);
  }

  if (typeof info.max === 'undefined') {
    return new Error(`No token max supply provided!`);
  }

  if (typeof info.max === 'string') {
    try {
      info.max = BigInt(info.max);
    } catch (error) {
      return error;
    }
  } else if (typeof info.max !== 'bigint') {
    return new Error(`Invalid token max supply!`);
  }
}
