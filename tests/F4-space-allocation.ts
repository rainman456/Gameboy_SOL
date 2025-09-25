import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { WagerProgram } from "../target/types/wager_program";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { createMint, createAssociatedTokenAccount } from "@solana/spl-token";
import { expect } from "chai";

const TOKEN_PROGRAM_ID = anchor.utils.token.TOKEN_PROGRAM_ID;
const ASSOCIATED_TOKEN_PROGRAM_ID = anchor.utils.token.ASSOCIATED_TOKEN_PROGRAM_ID;

describe("F4: Fixed Space Allocation", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.WagerProgram as Program<WagerProgram>;
  const gameServer = Keypair.generate();
  let mint: PublicKey;
  let vaultToken: PublicKey;
  let longSessionId = "a".repeat(20); // Exceeds assumed 10-byte space but <32 seed max
  let gameSessionPda: PublicKey;
  let vaultPda: PublicKey;

  before(async () => {
    await provider.connection.requestAirdrop(gameServer.publicKey, 1e9);

    mint = await createMint(provider.connection, provider.wallet.payer, provider.wallet.publicKey, null, 9);
    [gameSessionPda] = await PublicKey.findProgramAddress([Buffer.from("game_session"), Buffer.from(longSessionId)], program.programId);
    [vaultPda] = await PublicKey.findProgramAddress([Buffer.from("vault"), Buffer.from(longSessionId)], program.programId);
    vaultToken = await createAssociatedTokenAccount(
      provider.connection,
      provider.wallet.payer,
      mint,
      vaultPda,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
      true
    );
  });

  it("Fails creation with long session ID", async () => {
    try {
      await program.methods.createGameSession(longSessionId, new anchor.BN(1000), { winnerTakesAllOneVsOne: {} })
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
        .rpc();
      expect.fail("Should have thrown error for long ID");
    } catch (error) {
      expect(error.toString()).to.include("AccountDataTooSmall"); // Updated assertion for space error
    }
  });
});