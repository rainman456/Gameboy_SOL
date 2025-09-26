// tests/F7-fund-locking.ts
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { WagerProgram } from "../target/types/wager_program";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { createMint, createAssociatedTokenAccount, mintTo, getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { expect } from "chai";
import { TOKEN_ID } from "../target/types/wager_program";

const TOKEN_PROGRAM_ID = anchor.utils.token.TOKEN_PROGRAM_ID;
const ASSOCIATED_TOKEN_PROGRAM_ID = anchor.utils.token.ASSOCIATED_PROGRAM_ID;

describe("F7: Fund Locking via Partial Refund", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.WagerProgram as Program<WagerProgram>;
  const gameServer = Keypair.generate();
  const player1 = Keypair.generate();
  let mint: PublicKey;
  let player1Token: PublicKey;
  let vaultToken: PublicKey;
  let sessionId = "test_locking";
  let gameSessionPda: PublicKey;
  let vaultPda: PublicKey;

  before(async () => {
    await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(gameServer.publicKey, 1e9));
    await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(player1.publicKey, 1e9));

    // mint = TOKEN_ID;
    mint = await createMint(provider.connection, provider.wallet.payer, provider.wallet.publicKey, null, 9);
    player1Token = await createAssociatedTokenAccount(provider.connection, provider.wallet.payer, mint, player1.publicKey);
    await mintTo(provider.connection, provider.wallet.payer, mint, player1Token, provider.wallet.publicKey, 1000000);
    
    [gameSessionPda] = await PublicKey.findProgramAddress([Buffer.from("game_session"), Buffer.from(sessionId)], program.programId);
    [vaultPda] = await PublicKey.findProgramAddress([Buffer.from("vault"), Buffer.from(sessionId)], program.programId);
    vaultToken = getAssociatedTokenAddressSync(mint, vaultPda, true);
  });

  it("Locks extra funds after refund in pay-to-spawn", async () => {
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

    // Join (collect initial 1000)
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

    // 5 pay_to_spawn (collect extra 5000; total vault 6000)
    for (let i = 0; i < 5; i++) {
      await program.methods.payToSpawn(sessionId, 0)
        .accounts({
          user: player1.publicKey,
          gameServer: gameServer.publicKey,
          gameSession: gameSessionPda,
          userTokenAccount: player1Token,
          vault: vaultPda,
          vaultTokenAccount: vaultToken,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([player1])
        .rpc();
    }

    // Pre-refund vault balance
    const preRefundVault = await getAccount(provider.connection, vaultToken);
    expect(Number(preRefundVault.amount)).to.equal(6000, "Vault should have 6000 before refund");

    // Refund (only initial 1000; marks completed)
    await program.methods.refundWager(sessionId)
      .accounts({
        gameServer: gameServer.publicKey,
        gameSession: gameSessionPda,
        vault: vaultPda,
        vaultTokenAccount: vaultToken,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts([
        { pubkey: player1.publicKey, isWritable: false, isSigner: false },
        { pubkey: player1Token, isWritable: true, isSigner: false },
      ])
      .signers([gameServer])
      .rpc();

    // Post-refund: vault still has 5000 locked
    const postRefundVault = await getAccount(provider.connection, vaultToken);
    expect(Number(postRefundVault.amount)).to.equal(5000, "Extra funds locked in vault"); // Assertion: Locked funds
  });
});