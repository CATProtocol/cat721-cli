import { join } from 'path';
import { getRawTransaction, btc } from '../dist/common';
import { ConfigService } from '../dist/providers';
import { getCatCommitScript } from '@cat-protocol/cat-smartcontracts';
import { readFileSync } from 'fs';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const cbor = require('cbor');

function encodeMetaData(
  metadata: any = {
    name: 'cat721',
    symbol: 'cat721',
    description: 'this is a cat721 nft collection',
    max: 1000n,
  },
) {
  const icon = readFileSync(join(__dirname, '..', 'logo.png')).toString(
    'base64',
  );

  Object.assign(metadata, {
    minterMd5: '4b17fb22a536da0550d51a1cd9003911',
  });

  Object.assign(metadata, {
    icon: icon,
  });

//   Object.assign(metadata, {
//     minterMd5: '4b17fb22a536da0550d51a1cd9003911',
//   });

  const commitScript = getCatCommitScript(
    '95dd2038a862d8f9327939bc43d182185e4e678a34136276ca52bf4b5355fa3c',
    metadata,
    false,
  );

  decodeLockingScript(btc.Script.fromHex(commitScript));
}

//encodeMetaData();

function decodeLockingScript(lockingScript: btc.Script) {
  let metadataHex = '';
  for (let i = 0; i < lockingScript.chunks.length; i++) {
    const chunk = lockingScript.chunks[i];

    if (chunk.opcodenum === 3 && chunk.buf.toString('hex') === '636174') {
      for (let j = i + 2; i < lockingScript.chunks.length; j++) {
        const metadatachunk = lockingScript.chunks[j];
        if (
          metadatachunk.opcodenum === btc.Opcode.OP_PUSHDATA2 ||
          metadatachunk.opcodenum === btc.Opcode.OP_PUSHDATA1
        ) {
          metadataHex += metadatachunk.buf.toString('hex');
        } else if (metadatachunk.opcodenum === btc.Opcode.OP_ENDIF) {
          break;
        }
      }
    }
  }

  try {
    console.log(cbor.decodeAllSync(metadataHex)); // [2, 2]
  } catch (e) {
    // Throws on invalid input
    console.log('e', e);
  }
}
async function decodeMetaData(txid: string) {
  const config = new ConfigService();
  config.loadCliConfig(join(__dirname, '..', 'config.json'));
  const txHex = await getRawTransaction(config, txid);

  if (txHex instanceof Error) {
    throw txHex;
  }

  const tx = new btc.Transaction(txHex);

  const witnesses = tx.inputs[0].getWitnesses();

  const lockingScript = btc.Script.fromBuffer(witnesses[witnesses.length - 2]);

  decodeLockingScript(lockingScript);
}

decodeMetaData(
  '9eac41082f8d045d2d31d0fa635fef44fba9df64e10da7a502f1b1def1843916',
);
