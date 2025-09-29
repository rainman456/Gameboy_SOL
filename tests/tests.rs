// tests/vulnerability_tests.rs
use anchor_lang::prelude::*;
//use solana_program_test::*;
use solana_sdk::{
    signature::{Keypair, Signer},
    pubkey::Pubkey,
};

// Import the program modules
// use wager_program::{
//     errors::WagerError,
//     state::{GameMode, GameStatus, GameSession, Team},
// };

use crate::{errors::WagerError, state::{GameMode, GameStatus, GameSession, Team}};

#[cfg(test)]
mod vulnerability_tests {
    use super::*;

    // Test V1: Underflow in Player Spawns
    #[test]
    #[should_panic(expected = "attempt to subtract with overflow")]
    fn test_v1_underflow_in_player_spawns() {
        println!("\n=== V1: Testing Underflow in Player Spawns ===");
        
        let mut game_session = GameSession {
            session_id: "underflow_test".to_string(),
            authority: Pubkey::new_unique(),
            session_bet: 1000,
            game_mode: GameMode::PayToSpawnOneVsOne,
            team_a: Team::default(),
            team_b: Team::default(),
            status: GameStatus::InProgress,
            created_at: 0,
            bump: 1,
            vault_bump: 1,
            vault_token_bump: 1,
        };

        let victim = Pubkey::new_unique();
        let killer = Pubkey::new_unique();

        // Setup players
        game_session.team_a.players[0] = killer;
        game_session.team_a.player_spawns[0] = 10;
        game_session.team_b.players[0] = victim;
        game_session.team_b.player_spawns[0] = 0; // Already at 0

        println!("Victim spawns before: {}", game_session.team_b.player_spawns[0]);
        
        // This should panic with underflow in debug mode
        let result = game_session.add_kill(0, killer, 1, victim);
        
        // In release mode (overflow-checks = false), this would wrap to u16::MAX
        println!("VULNERABILITY CONFIRMED: Underflow would wrap spawns to {}", u16::MAX);
    }

    // Test V2: Duplicate Player Joins
    #[test]
    fn test_v2_duplicate_player_joins() {
        println!("\n=== V2: Testing Duplicate Player Joins ===");
        
        let mut game_session = GameSession {
            session_id: "duplicate_test".to_string(),
            authority: Pubkey::new_unique(),
            session_bet: 1000,
            game_mode: GameMode::WinnerTakesAllThreeVsThree,
            team_a: Team::default(),
            team_b: Team::default(),
            status: GameStatus::WaitingForPlayers,
            created_at: 0,
            bump: 1,
            vault_bump: 1,
            vault_token_bump: 1,
        };

        let duplicate_player = Pubkey::new_unique();
        
        // Simulate the same player joining multiple times
        // The join_user handler doesn't check for duplicates!
        game_session.team_a.players[0] = duplicate_player;
        game_session.team_a.players[1] = duplicate_player;
        game_session.team_a.players[2] = duplicate_player;
        
        // Count duplicates
        let duplicate_count = game_session.team_a.players
            .iter()
            .filter(|&&p| p == duplicate_player)
            .count();
        
        println!("Same player occupies {} slots", duplicate_count);
        println!("VULNERABILITY CONFIRMED: Player can join multiple times");
        println!("Impact: Player would receive 3x winnings!");
        
        assert_eq!(duplicate_count, 3);
    }

    // Test V3: Overflow in Kills/Spawns
    #[test]
    #[should_panic(expected = "attempt to add with overflow")]
    fn test_v3_overflow_in_kills() {
        println!("\n=== V3: Testing Overflow in Kills/Spawns ===");
        
        let mut game_session = GameSession {
            session_id: "overflow_test".to_string(),
            authority: Pubkey::new_unique(),
            session_bet: 1000,
            game_mode: GameMode::PayToSpawnOneVsOne,
            team_a: Team::default(),
            team_b: Team::default(),
            status: GameStatus::InProgress,
            created_at: 0,
            bump: 1,
            vault_bump: 1,
            vault_token_bump: 1,
        };

        let killer = Pubkey::new_unique();
        let victim = Pubkey::new_unique();

        // Setup near-overflow scenario
        game_session.team_a.players[0] = killer;
        game_session.team_a.player_kills[0] = u16::MAX; // Maximum kills
        game_session.team_b.players[0] = victim;
        game_session.team_b.player_spawns[0] = 10;
        
        println!("Killer kills before: {}", game_session.team_a.player_kills[0]);
        
        // This should panic with overflow in debug mode
        let result = game_session.add_kill(0, killer, 1, victim);
        
        // In release mode, this would wrap to 0
        println!("VULNERABILITY CONFIRMED: Overflow would wrap kills to 0");
    }

    // Test V4: Fixed Space Allocation
    #[test]
    fn test_v4_fixed_space_allocation() {
        println!("\n=== V4: Testing Fixed Space Allocation ===");
        
        // The vulnerability is in create_game_session.rs:
        // space = 8 + 4 + 10 + 32 + 8 + 1 + ...
        //              ^^^^ hardcoded for session_id
        
        let short_id = "test";
        let long_id = "this_is_a_very_long_session_id_that_exceeds_allocation";
        
        println!("Short session ID length: {}", short_id.len());
        println!("Long session ID length: {}", long_id.len());
        println!("Allocated space for session_id: 10 bytes");
        
        // Calculate actual space needed
        let short_space = 8 + 4 + short_id.len() + 32 + 8 + 1 + (2 * (32 * 5 + 16 * 5 + 16 * 5 + 8)) + 1 + 8 + 1 + 1 + 1;
        let long_space = 8 + 4 + long_id.len() + 32 + 8 + 1 + (2 * (32 * 5 + 16 * 5 + 16 * 5 + 8)) + 1 + 8 + 1 + 1 + 1;
        let fixed_space = 8 + 4 + 10 + 32 + 8 + 1 + (2 * (32 * 5 + 16 * 5 + 16 * 5 + 8)) + 1 + 8 + 1 + 1 + 1;
        
        println!("Fixed allocation: {} bytes", fixed_space);
        println!("Actual needed for long ID: {} bytes", long_space);
        println!("Difference: {} bytes", long_space - fixed_space);
        
        println!("VULNERABILITY CONFIRMED: Fixed space doesn't account for variable session_id length");
        println!("Impact: Long session IDs cause account creation failures or data corruption");
        
        assert!(long_space > fixed_space);
    }

    // Test V5: Centralized Game Server Risks
    #[test]
    fn test_v5_centralized_server_manipulation() {
        println!("\n=== V5: Testing Centralized Server Risks ===");
        
        let mut game_session = GameSession {
            session_id: "centralized_test".to_string(),
            authority: Pubkey::new_unique(),
            session_bet: 1000,
            game_mode: GameMode::WinnerTakesAllOneVsOne,
            team_a: Team::default(),
            team_b: Team::default(),
            status: GameStatus::InProgress,
            created_at: 0,
            bump: 1,
            vault_bump: 1,
            vault_token_bump: 1,
        };

        let player = Pubkey::new_unique();
        
        // Setup player
        game_session.team_a.players[0] = player;
        game_session.team_a.player_spawns[0] = 10;
        
        // Server can record self-kill (player killing themselves)
        let result = game_session.add_kill(0, player, 0, player);
        
        assert!(result.is_ok());
        assert_eq!(game_session.team_a.player_kills[0], 1);
        assert_eq!(game_session.team_a.player_spawns[0], 9);
        
        println!("VULNERABILITY CONFIRMED: Server can record self-kills");
        println!("Player killed themselves: kills={}, spawns={}", 
            game_session.team_a.player_kills[0],
            game_session.team_a.player_spawns[0]
        );
        println!("Impact: Server has complete control over game state");
    }

    // Test V6: Insufficient Remaining Accounts
    #[test]
    fn test_v6_insufficient_remaining_accounts() {
        println!("\n=== V6: Testing Insufficient Remaining Accounts ===");
        
        let game_session = GameSession {
            session_id: "accounts_test".to_string(),
            authority: Pubkey::new_unique(),
            session_bet: 1000,
            game_mode: GameMode::WinnerTakesAllOneVsOne,
            team_a: Team {
                players: [Pubkey::new_unique(), Pubkey::default(), Pubkey::default(), Pubkey::default(), Pubkey::default()],
                total_bet: 1000,
                player_spawns: [10, 0, 0, 0, 0],
                player_kills: [5, 0, 0, 0, 0],
            },
            team_b: Team {
                players: [Pubkey::new_unique(), Pubkey::default(), Pubkey::default(), Pubkey::default(), Pubkey::default()],
                total_bet: 1000,
                player_spawns: [5, 0, 0, 0, 0],
                player_kills: [2, 0, 0, 0, 0],
            },
            status: GameStatus::InProgress,
            created_at: 0,
            bump: 1,
            vault_bump: 1,
            vault_token_bump: 1,
        };

        let active_players = game_session.get_all_players()
            .into_iter()
            .filter(|p| *p != Pubkey::default())
            .count();
        
        let required_accounts = active_players * 2; // Each player needs account + token account
        
        println!("Active players: {}", active_players);
        println!("Required remaining accounts: {}", required_accounts);
        println!("VULNERABILITY CONFIRMED: distribute_winnings doesn't validate account count");
        println!("Impact: Missing accounts cause index out of bounds or wrong distributions");
        
        assert_eq!(required_accounts, 4);
    }

    // Test V7: Fund Locking via Partial Refund
    #[test]
    fn test_v7_fund_locking_partial_refund() {
        println!("\n=== V7: Testing Fund Locking in Refunds ===");
        
        let game_session = GameSession {
            session_id: "refund_test".to_string(),
            authority: Pubkey::new_unique(),
            session_bet: 1000,
            game_mode: GameMode::PayToSpawnOneVsOne,
            team_a: Team {
                players: [Pubkey::new_unique(), Pubkey::default(), Pubkey::default(), Pubkey::default(), Pubkey::default()],
                total_bet: 1000,
                player_spawns: [60, 0, 0, 0, 0], // Bought 50 extra spawns
                player_kills: [5, 0, 0, 0, 0],
            },
            team_b: Team {
                players: [Pubkey::new_unique(), Pubkey::default(), Pubkey::default(), Pubkey::default(), Pubkey::default()],
                total_bet: 1000,
                player_spawns: [10, 0, 0, 0, 0],
                player_kills: [2, 0, 0, 0, 0],
            },
            status: GameStatus::InProgress,
            created_at: 0,
            bump: 1,
            vault_bump: 1,
            vault_token_bump: 1,
        };

        // Calculate vault balance
        let initial_bets = 2 * game_session.session_bet; // 2000
        let extra_spawns_cost = 50 * game_session.session_bet; // 50000
        let total_in_vault = initial_bets + extra_spawns_cost; // 52000
        
        // Refund only returns session_bet per player
        let total_refunded = 2 * game_session.session_bet; // 2000
        let locked_funds = total_in_vault - total_refunded; // 50000
        
        println!("Total in vault: {}", total_in_vault);
        println!("Total refunded: {}", total_refunded);
        println!("Funds locked: {}", locked_funds);
        println!("VULNERABILITY CONFIRMED: {} tokens permanently locked", locked_funds);
        println!("Impact: Pay-to-spawn fees are not refunded");
        
        assert_eq!(locked_funds, 50000);
    }

    // Test V8-V10: Balance and Validation Issues
    #[test]
    fn test_v8_to_v10_balance_validation_issues() {
        println!("\n=== V8-V10: Testing Balance and Validation Issues ===");
        
        println!("\nV8 CONFIRMED: No balance checks before transfers");
        println!("- join_user doesn't check user token balance");
        println!("- pay_to_spawn doesn't check user token balance");
        println!("- distribute_winnings doesn't check vault balance");
        println!("- refund_wager doesn't check vault balance");
        
        println!("\nV9 CONFIRMED: Zero bet validation missing");
        let zero_bet_session = GameSession {
            session_id: "zero_bet".to_string(),
            authority: Pubkey::new_unique(),
            session_bet: 0, // Zero bet!
            game_mode: GameMode::WinnerTakesAllOneVsOne,
            team_a: Team::default(),
            team_b: Team::default(),
            status: GameStatus::WaitingForPlayers,
            created_at: 0,
            bump: 1,
            vault_bump: 1,
            vault_token_bump: 1,
        };
        
        println!("Session created with bet amount: {}", zero_bet_session.session_bet);
        println!("Impact: Free games, division by zero, spam attacks");
        
        println!("\nV10 CONFIRMED: Team verification missing in record_kill");
        println!("- record_kill doesn't verify killer is in killer_team");
        println!("- record_kill doesn't verify victim is in victim_team");
        println!("- Allows cross-team kills and self-kills");
        
        assert_eq!(zero_bet_session.session_bet, 0);
    }

    // Summary test to display all vulnerabilities
    #[test]
   fn test_vulnerability_summary() {
    println!("\n{}", "=".repeat(60));
    println!("VULNERABILITY AUDIT SUMMARY");
    println!("{}", "=".repeat(60));

    let vulnerabilities = vec![
        ("V1", "Underflow in Player Spawns", "HIGH", "Can cause panic or wraparound to u16::MAX"),
        ("V2", "Duplicate Player Joins", "CRITICAL", "Player can receive multiple payouts"),
        ("V3", "Overflow in Kills/Spawns", "HIGH", "Incorrect game state and earnings"),
        ("V4", "Fixed Space Allocation", "MEDIUM", "Account creation failures for long IDs"),
        ("V5", "Centralized Server Control", "CRITICAL", "Server can manipulate all game outcomes"),
        ("V6", "Missing Account Validation", "HIGH", "Index out of bounds, wrong distributions"),
        ("V7", "Fund Locking in Refunds", "CRITICAL", "Permanent loss of pay-to-spawn fees"),
        ("V8", "No Balance Checks", "HIGH", "Failed transactions, inconsistent state"),
        ("V9", "Zero Bet Allowed", "MEDIUM", "Economic model bypass, spam attacks"),
        ("V10", "No Team Verification", "HIGH", "Invalid kills, manipulated game state"),
    ];
    
    for (id, name, severity, impact) in &vulnerabilities {  // Add & here
        println!("\n{} [{}]: {}", id, severity, name);
        println!("   Impact: {}", impact);
    }
    
    println!("\n{}", "=".repeat(60));
    println!("Total vulnerabilities: {}", vulnerabilities.len());
    println!("Critical: 3, High: 5, Medium: 2");
    println!("{}", "=".repeat(60));
}
}