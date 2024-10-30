# CAT CLI

`cli` requires a synced [tracker](../tracker/README.md).

## Installation

```bash
yarn install
```

## Build

```sh
yarn build
```

## Usage

1. Copy [config.example.json](config.example.json) as `config.json`. Update `config.json` with your own configuration.

All commands use the `config.json` in the current working directory by default. You can also specify a customized configuration file with `--config=your.json`.

2. Create a wallet

```bash
yarn cli wallet create
```

You should see an output similar to:

```
? What is the mnemonic value of your account? (default: generate a new mnemonic) ********
Your wallet mnemonic is:  ********
exporting address to the RPC node ... 
successfully.
```

3. Show address

```bash
yarn cli wallet address
```

You should see an output similar to:

```
Your address is bc1plfkwa8r7tt8vvtwu0wgy2m70d6cs7gwswtls0shpv9vn6h4qe7gqjjjf86
```

4. Fund your address

Deposit some satoshis to your address.


5. Show nfts

```bash
yarn cli wallet balances -i 917f97da0c3b4f9105d38b82134e570093956a0cc6001c59582f4d713aed6a93_0
```

You should see an output similar to:

```
┌──────────────────────────────────────────────────────────────────────┬──────────┬─────────┐
│ collectionId                                                         │ symbol   │ localId │
┼──────────────────────────────────────────────────────────────────────┼──────────┼─────────┤
│ '917f97da0c3b4f9105d38b82134e570093956a0cc6001c59582f4d713aed6a93_0' │ 'cat721' │ 1n      │
│ '917f97da0c3b4f9105d38b82134e570093956a0cc6001c59582f4d713aed6a93_0' │ 'cat721' │ 0n      │
┴──────────────────────────────────────────────────────────────────────┴──────────┴─────────┘
```

6. Deploy a collection

- deploy with a metadata json:

```bash
yarn cli deploy --metadata=example.json
```

`example.json`:

```json
{
    "name": "cat721",
    "symbol": "cat721",
    "description": "this is a cat721 nft collection",
    "max": "1000"
}
```

- deploy with command line options:

```bash
yarn cli deploy --name=cat721 --symbol=cat721 --max=1000
```

You should see an output similar to:

```
Nft collection cat721 has been deployed.
CollectionId: 917f97da0c3b4f9105d38b82134e570093956a0cc6001c59582f4d713aed6a93_0
Genesis txid: 917f97da0c3b4f9105d38b82134e570093956a0cc6001c59582f4d713aed6a93
Reveal txid: ac901e6b9f62c38288751cbf7a80b0e12aa354f3cdb7ec42f1c8a3c1c10636ff
```


1. Mint nft

```bash
yarn cli mint -i [collectionId]
```
You should see an output similar to:

```
Minting cat721 NFT in txid: ef9d98eeae21c6bd8aa172cc1d78d9e4e3749a7632e4119f2f2484396f95f5cb ...
```

1. Send nft

```bash
yarn cli send -i [collectionId] -l [localId] [receiver]
```
You should see an output similar to:

```
Sending cat721:0 nft  to bc1ppresfm876y9ddn3fgw2zr0wj0pl3zanslje9nfpznq3kc90q46rqvm9k07 
in txid: 277eb0198b4fed9a03845d279cf58fc3289e8a68abdd36981381accb8c24ef52
```

-----------------

### FeeRate

`deploy`, `mint`, and `send` commands can all specify a fee rate via option `--fee-rate`.