# Recurring Payments Contract

A Soroban smart contract that lets users authorize on-chain recurring transfers without giving the contract custody of their funds.

## Design

- The contract stores **authorization only** — no funds are held.
- Payments are pulled directly from the sender's wallet to the recipient via `transfer_from` (the sender must approve the contract as a spender).
- Execution is **permissionless**: anyone can call `execute_payment` once a schedule is due, enabling incentivized keeper bots.

## Functions

| Function | Auth required | Description |
|---|---|---|
| `initialize(token_address)` | — | One-time setup, stores the token contract address |
| `authorize_recurring(sender, recipient, amount, interval)` | sender | Creates a recurring schedule, returns schedule ID |
| `execute_payment(executor, schedule_id)` | executor | Executes a due payment; anyone may call this |
| `cancel_recurring(sender, schedule_id)` | sender | Cancels an active schedule |
| `get_schedule(schedule_id)` | — | Read a schedule by ID |

## Schedule lifecycle

```
authorize_recurring → Active
                         │
          ┌──────────────┴──────────────┐
          │                             │
   execute_payment               cancel_recurring
   (repeats each interval)            │
                                  Cancelled
```

## Missed payments

Each window opens at `next_payment_at` and stays open for `grace_period_secs`.
When `execute_payment` is called after a window's grace period has expired:

- **Every** expired window counts as a miss — a schedule left idle for six
  months records ~180 daily misses in one call, not one.
- `next_payment_at` moves to the first window that has not expired; no payment
  is made in that call.
- `PaymentMissed { schedule_id, missed_at, newly_missed, total_missed }` is emitted.
- If `total_missed >= max_missed_executions` the schedule becomes `Cancelled`
  and `ScheduleAutoCancelled { schedule_id, total_missed, cancelled_at }` is emitted.

A successful payment resets the consecutive-miss counter to 0.

## Prerequisites

- Rust with `wasm32-unknown-unknown` target: `rustup target add wasm32-unknown-unknown`
- Stellar CLI: https://developers.stellar.org/docs/tools/developer-tools/cli/install-cli

## Build & test

```bash
cd contracts/recurring-payments

# Run tests
cargo test

# Build WASM
cargo build --release --target wasm32-unknown-unknown
```

## Deploy

```bash
# From the contracts/ directory
STELLAR_NETWORK=testnet SOROBAN_SECRET_KEY=<your-key> ./deploy.sh recurring-payments
```

After deployment call `initialize` with the USDC token contract address, then update `RECURRING_PAYMENTS_CONTRACT_ID` in your backend `.env`.

## Backend integration

The backend scheduled-payments service should:

1. Watch for `ScheduleAuthorized` events to track active schedules.
2. Call `execute_payment` when `next_payment_at <= now` (can be incentivized with a small tip).
3. Watch for `ScheduleCancelled` events to stop tracking a schedule.
