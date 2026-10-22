# Smart Contracts

This directory contains Soroban smart contracts for the AfriPay cross-border payment platform.

## Contracts

### Escrow Contract (`escrow/`)
A trustless on-chain escrow contract for USDC remittances.

**Features:**
- Three-party escrow model (sender, recipient, agent)
- Automated fee calculation and collection
- Event emission for blockchain transparency
- Full test coverage
- Comprehensive documentation

**Quick Links:**
- Documentation: [escrow/README.md](./escrow/README.md)
- Source: [escrow/src/lib.rs](./escrow/src/lib.rs)
- Deployment: [deploy.sh](./deploy.sh)

## Building

```bash
cd escrow
cargo build --release --target wasm32-unknown-unknown
cargo test
```

## Deployment

The deploy script never passes a secret key on the command line. It signs with a
named Stellar CLI identity (`--source <identity>`).

### Deployer identity setup

**Testnet** — create or import an identity once (the key is read from a prompt/stdin, not argv):

```bash
stellar keys generate afripay-testnet-deployer --network testnet --fund
# or: stellar keys add afripay-testnet-deployer --secret-key   (paste key at the prompt)
SOROBAN_IDENTITY=afripay-testnet-deployer bash deploy.sh
```

As a testnet-only convenience, `SOROBAN_SECRET_KEY` is still accepted: the script imports it
into an identity via stdin and unsets the variable before any deploy call.

**Mainnet** — an explicit identity is required (no env-secret fallback); a Ledger is recommended:

```bash
stellar keys add afripay-mainnet --ledger      # or another hardware-backed identity
EXPECTED_WASM_HASH=<sha256 of audited wasm> SOROBAN_IDENTITY=afripay-mainnet \
  bash deploy.sh --network mainnet --confirm-mainnet
```

The script exits non-zero (without writing `.deployed_ids.env`) if the deploy fails, the
returned contract ID is not a valid `C…` address, or the WASM hash does not match
`EXPECTED_WASM_HASH` (mandatory on mainnet).

### Integration tests

`integration-tests/` registers all contracts in a single test `Env` and exercises KYC → escrow →
release → fee distributor → dispute, recurring payments with a fee, and savings deposit/withdraw:

```bash
cd integration-tests && cargo test
```

See [deploy.sh](./deploy.sh) for detailed deployment instructions and network configuration.

## Development

### Prerequisites
- Rust 1.70+
- Soroban CLI
- wasm32 target: `rustup target add wasm32-unknown-unknown`

### Testing
```bash
cd escrow
cargo test
```

### Building for Production
```bash
cd escrow
cargo build --release --target wasm32-unknown-unknown
```

## Integration

The escrow contract is designed to integrate with the AfriPay backend to replace the centralized payment logic with trustless on-chain operations.

### Backend Integration Steps
1. Deploy the contract and save the contract ID
2. Update backend environment variables with `ESCROW_CONTRACT_ID` and `ESCROW_USDC_ADDRESS`
3. Modify payment controller to invoke contract functions instead of direct transfers
4. Listen for escrow events on Stellar for state synchronization

### Next Steps
1. Test on Stellar testnet
2. Get security audit from Soroban auditors
3. Deploy to mainnet
4. Gradual migration of escrow operations from backend to contract

## Resources

- [Soroban Docs](https://soroban.stellar.org)
- [Stellar Expert](https://stellar.expert)
- [USDC on Stellar](https://www.circle.com/usdc-on-stellar)

## License

See root LICENSE file.
