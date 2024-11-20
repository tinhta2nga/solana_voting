import { Voting } from "./../target/types/voting";
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import { assert } from "chai";

describe("Voting", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Voting as Program<Voting>;

  const pollId = new anchor.BN(1);
  const description = "Test Poll";
  const candidateName = "A";
  const startTime = new anchor.BN(Date.now());
  const endTime = new anchor.BN(Date.now() + 100000);

  // PDA Addresses - context account (store program data)
  // determine this one by define the context in main program
  let pollAccount: anchor.web3.PublicKey;
  let candidateAccount: anchor.web3.PublicKey;
  let voterAccount: anchor.web3.PublicKey;

  // Main user keypair
  const owner = anchor.AnchorProvider.local().wallet;
  const user = anchor.web3.Keypair.generate();

  it("Initialized A Poll!", async () => {
    // First step, we need derive the poll PDA account
    [pollAccount] = await anchor.web3.PublicKey.findProgramAddressSync(
      [pollId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    // next, we will call the desired function, in this case is initialize function
    await program.methods
      .initialize(pollId, description, startTime, endTime)
      .accounts({
        pollAccount,
        signer: owner.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    // Then, we fetch the poll account to validate the initialization process
    const poll = await program.account.poll.fetch(pollAccount); // poll struct transform to program.account.poll

    console.log("Poll ID:", poll.pollId.toNumber());

    assert.strictEqual(poll.pollId.toNumber(), pollId.toNumber());
    assert.strictEqual(poll.description, description);
    assert.strictEqual(poll.candidateAmount.toNumber(), 0);
  });

  // Initialize Candidate
  it("Adds a candidate to the poll", async () => {
    // Derive the candidate account PDA
    [candidateAccount] = await anchor.web3.PublicKey.findProgramAddressSync(
      [pollId.toArrayLike(Buffer, "le", 8), Buffer.from(candidateName)],
      program.programId
    );

    // Call the initialize_candidate function
    await program.methods
      .initializeCandidate(candidateName, pollId)
      .accounts({
        pollAccount,
        candidateAccount,
        signer: owner.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    // Fetch the candidate account to validate initialization
    const candidate = await program.account.candidate.fetch(candidateAccount);
    assert.strictEqual(candidate.candidateName, candidateName);
    assert.strictEqual(candidate.candidateVote.toNumber(), 0);
  });

  // Vote for Candidate
  it.skip("Votes for a candidate", async () => {
    // Derive the voter account PDA
    [voterAccount] = await anchor.web3.PublicKey.findProgramAddress(
      [pollId.toArrayLike(Buffer, "le", 8), signer.publicKey.toBuffer()],
      program.programId
    );

    // Call the vote function
    await program.methods
      .vote(pollId, candidateName)
      .accounts({
        pollAccount,
        candidateAccount,
        voterAccount,
        signer: signer.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    // Fetch the candidate account to validate the vote
    const candidate = await program.account.candidate.fetch(candidateAccount);
    assert.strictEqual(candidate.candidateVote.toNumber(), 1);

    // Fetch the voter account to ensure it was created
    const voter = await program.account.voter.fetch(voterAccount);
    assert.strictEqual(voter.pollId.toNumber(), pollId.toNumber());
    assert.strictEqual(voter.voter.toString(), signer.publicKey.toString());
  });

  // Prevent Duplicate Votes
  it.skip("Prevents duplicate votes", async () => {
    try {
      // Attempt to vote again
      await program.methods
        .vote(pollId, candidateName)
        .accounts({
          pollAccount,
          candidateAccount,
          voterAccount,
          signer: signer.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      assert.fail("Expected an error for duplicate voting");
    } catch (err) {
      // Check for the custom AlreadyVoted error
      assert.strictEqual(err.error.errorCode.code, "AlreadyVoted");
    }
  });

  // Test Invalid Poll ID
  it.skip("Fails for an invalid poll ID", async () => {
    const invalidPollId = new anchor.BN(999); // Non-existent poll
    const invalidVoterAccount = anchor.web3.Keypair.generate();

    try {
      await program.methods
        .vote(invalidPollId, candidateName)
        .accounts({
          pollAccount: invalidPollId,
          candidateAccount,
          voterAccount: invalidVoterAccount.publicKey,
          signer: signer.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      assert.fail("Expected an error for invalid poll ID");
    } catch (err) {
      assert.include(err.message, "AccountNotInitialized");
    }
  });
});
