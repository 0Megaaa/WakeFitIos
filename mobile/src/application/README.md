# Application Layer

## Responsibilities

- Use Cases
- Application Services
- Create alarm
- Update alarm
- Start challenge
- Complete challenge
- Safe exit
- Save workout
- Recalculate streak
- Sync workflow orchestration

## Constraints

- Can only depend on:
  - domain layer
  - Repository interfaces
  - Platform Service interfaces

- MUST NOT depend on:
  - SQLite implementation
  - Fetch implementation
  - Native module implementation
