// tests/F6-accounts-validation.ts
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { WagerProgram } from "../target/types/wager_program";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { createMint, createAssociatedTokenAccount, mintTo, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { expect } from "chai";
import { TOKEN_ID } from "../target/types/wager_program";

const TOKEN_PROGRAM_ID = anchor.utils.token.TOKEN_PROGRAM_ID;
const ASSOCIATED_TOKEN_PROGRAM_ID = anchor.utils.token.ASSOCIATED_TOKEN_PROGRAM_ID;

describe("F6: Insufficient Remaining Accounts", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.WagerProgram as Program<WagerProgram>;
  const gameServer = Keypair.generate();
  const player1 = Keypair.generate();
  const player2 = Keypair.generate();
  let mint: PublicKey;
  let player1Token: PublicKey;
  let player2Token: PublicKey;
  let vaultToken: PublicKey;
  let sessionId = "test_accounts";
  let gameSessionPda: PublicKey;
  let vaultPda: PublicKey;

  before(async () => {
    // Same setup as F1
    await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(gameServer.publicKey, 1e9));
    await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(player1.publicKey, 1e9));
    await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(player2.publicKey, 1e9));

    // mint = TOKEN_ID;
    mint = await createMint(provider.connection, provider.wallet.payer, provider.wallet.publicKey, null, 9);
    player1Token = await createAssociatedTokenAccount(provider.connection, provider.wallet.payer, mint, player1.publicKey);
    player2Token = await createAssociatedTokenAccount(provider.connection, provider.wallet.payer, mint, player2.publicKey);
    await mintTo(provider.connection, provider.wallet.payer, mint, player1Token, provider.wallet.publicKey, 1000000);
    await mintTo(provider.connection, provider.wallet.payer, mint, player2Token, provider.wallet.publicKey, 1000000);
    
    [gameSessionPda] = await PublicKey.findProgramAddress([Buffer.from("game_session"), Buffer.from(sessionId)], program.programId);
    [vaultPda] = await PublicKey.findProgramAddress([Buffer.from("vault"), Buffer.from(sessionId)], program.programId);
    vaultToken = getAssociatedTokenAddressSync(mint, vaultPda, true);
  });

  it("Crashes distribution with insufficient accounts", async () => {
    // Create and join as F1
    await program.methods.createGameSession(sessionId, new anchor.BN(1000), { payToSpawnOneVsOne: {} })
      .accounts({
        gameServer: gameServer.publicKey,
        gameSession: gameSessionPda,
        vault: vaultPda,
        vaultTokenAccount: vaultToken,
        mint: mint,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([gameServer])
      .rpc({ skipPreflight: true });

    await program.methods.joinUser(sessionId, 0)
      .accounts({
        user: player1.publicKey,
        gameServer: gameServer.publicKey,
        gameSession: gameSessionPda,
        userTokenAccount: player1Token,
        vault: vaultPda,
        vaultTokenAccount: vaultToken,
        mint: mint,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([player1])
      .rpc();

    await program.methods.joinUser(sessionId, 1)
      .accounts({
        user: player2.publicKey,
        gameServer: gameServer.publicKey,
        gameSession: gameSessionPda,
        userTokenAccount: player2Token,
        vault: vaultPda,
        vaultTokenAccount: vaultToken,
        mint: mint,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([player2])
      .rpc();

    try {
      await program.methods.distributeWinnings(sessionId, 0)
        .accounts({ 
          gameServer: gameServer.publicKey,
          gameSession: gameSessionPda,
          vault: vaultPda,
          vaultTokenAccount: vaultToken,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts([]) // Empty, instead of 4 for 2 players
        .signers([gameServer])
        .rpc();
      expect.fail("Should throw on insufficient accounts");
    } catch (error) {
      expect(error.toString()).to.include("Invalid player"); // Assertion: Error on missing accounts (adjusted from "index out of range")
    }
  });
});