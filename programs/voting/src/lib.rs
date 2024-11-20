use anchor_lang::prelude::*;

declare_id!("Ec1HB25VENo6m1TUVXsP49yhHHXcbdHNd889qFkkqCkf");

#[program]
pub mod voting {
    use super::*;

    // this one we initialize poll
    // adding access control
    pub fn initialize(
        _ctx: Context<Initialize>,
        _poll_id: u64,
        _description: String,
        _start_time: u64,
        _end_time: u64,
    ) -> Result<()> {
        let _poll_account = &mut _ctx.accounts.poll_account;
        _poll_account.poll_id = _poll_id;
        _poll_account.description = _description;
        _poll_account.start_time = _start_time;
        _poll_account.end_time = _end_time;
        _poll_account.candidate_amount = 0;
        _poll_account.creator = _ctx.accounts.signer.key(); // who deploy = owner
        Ok(())
    }

    // we also need a function to initialize candidate
    // any variables have underscore before will not used
    // // Init create candidate function, linked a candidate account to poll account
    // add a check to ensure the signer is the creator of the poll
    pub fn initialize_candidate(
        _ctx: Context<InitializeCandidate>,
        _poll_id: u64,
        _candidate_name: String,
    ) -> Result<()> {
        // validate the poll account matched the poll_id
        let poll_account = &mut _ctx.accounts.poll_account; // point to poll_account account context

        require!(
            poll_account.creator == _ctx.accounts.signer.key(),
            CustomError::Unauthorized
        );
        require!(poll_account.poll_id == _poll_id, CustomError::PollMismatch);

        // Step 2: Update poll_account's candidate amount
        // this one mean : when user initialize, we must clarify which poll they belong to
        poll_account.candidate_amount += 1;

        let candidate: &mut Account<'_, Candidate> = &mut _ctx.accounts.candidate_account;

        candidate.candidate_name = _candidate_name.clone();
        candidate.candidate_vote = 0;

        // Log the creation
        msg!("Candidate '{}' created", _candidate_name,);
        Ok(())
    }

    // Increment the vote count of a candidate_account.
    // Ensure the candidate_account belongs to the correct poll_account.
    // Validate that the poll_account is currently active (within the voting timeframe).
    // ensure each voter only votes once.
    pub fn vote(
        _ctx: Context<InitializeVote>,
        _poll_id: u64,
        _candidate_name: String,
    ) -> Result<()> {
        msg!(
            "Derived voter_account PDA: {}",
            Pubkey::create_program_address(
                &[
                    _poll_id.to_le_bytes().as_ref(),
                    _ctx.accounts.signer.key().as_ref(),
                    &[_ctx.bumps["voter_account"]]
                ],
                _ctx.program_id
            )
            .unwrap()
        );

        let poll_account = &mut _ctx.accounts.poll_account;
        let current_time = Clock::get()?.unix_timestamp as u64;

        require!(
            current_time >= poll_account.start_time && current_time <= poll_account.end_time,
            CustomError::PollNotActive
        );

        //  If the account exists, Anchor will throw an error during the PDA validation.

        let candidate_account = &mut _ctx.accounts.candidate_account;
        candidate_account.candidate_vote += 1; // increment number of vote

        // user vote
        let voter_account = &mut _ctx.accounts.voter_account;
        voter_account.poll_id = _poll_id;
        voter_account.voter = _ctx.accounts.signer.key(); // Each voter who votes in a poll will have a Voter account tied to their public key and the poll's ID.

        msg!(
            "Vote registered for candidate '{}' in poll '{}'. Total votes: {}",
            _candidate_name,
            _poll_id,
            candidate_account.candidate_vote
        );

        Ok(())
    }

    // we will have function to create poll

    // function to help user vote
}

// Define Poll and Candidate struct
// creator field to track who own the poll
#[account]
#[derive(InitSpace)]
pub struct Poll {
    pub poll_id: u64,
    #[max_len(50)]
    pub description: String,
    pub start_time: u64,
    pub end_time: u64,
    pub candidate_amount: u64,
    pub creator: Pubkey, // creator of the poll
}

// A Candidate struct focuses on the candidate's details and votes.
#[account]
#[derive(InitSpace)]

pub struct Candidate {
    #[max_len(50)]
    pub candidate_name: String,
    pub candidate_vote: u64,
}

// A Voter struct focuses on tracking individual participation in a poll.
#[account]
#[derive(InitSpace)]
pub struct Voter {
    pub poll_id: u64, // ID of the poll this voter participated in
    pub voter: Pubkey,
}

// Context account

// Context for initialize program
// initialize poll
#[derive(Accounts)]
#[instruction(poll_id: u64)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = signer,
        space = 8 + Poll::INIT_SPACE,
        seeds = [poll_id.to_le_bytes().as_ref()], // ensure the poll account will always tie to specific poll id, No two polls will have the same account.
        bump
    )]
    pub poll_account: Account<'info, Poll>,
    #[account(mut)]
    pub signer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

// Initialize candidate (Create Candidate)
// each poll will have multiple candidate
// we must create candidate associated with specific poll
// By including poll_account in the context, the program ensures that:
// The candidate_account is properly linked to the correct poll_account.
// The poll_id provided matches an existing poll_account on-chain.
// When creating a candidate_account, you need to increment the candidate_amount in the corresponding poll_account.
// This requires the poll_account to be part of the context and mutable (#[account(mut)]).
// Including poll_account ensures that the candidate_account is always associated with a valid poll.
// If poll_account is missing, the program won’t have any reference to enforce this connection.
// The program derives poll_account using [poll_id.to_le_bytes().as_ref()]
// and validates that the passed poll_account matches this derived address.
// poll_account is the parent account for all candidate_accounts in your program.
// This means every candidate_account must reference a specific poll_account.

#[derive(Accounts)]
#[instruction(poll_id: u64, candidate_name: String)]
pub struct InitializeCandidate<'info> {
    // we will need the poll because we have to use it to increase the amount of candidate
    // we dont need the space as another stuff because we already init above
    //  avoids ambiguity about where and how the poll_account was initialized.
    #[account(
        seeds = [poll_id.to_le_bytes().as_ref()],
        bump
    )]
    #[account(mut)] // the function increments the candidate_amount field
    pub poll_account: Account<'info, Poll>,

    //Use PDA for candidate_account
    //  If you want each candidate_account to belong to a specific poll_account, you can use poll_account.key()
    // and candidate_name as seeds to create a unique address for the candidate.
    #[account(
        init,
        payer = signer,
        space = 8 + Candidate::INIT_SPACE,
        seeds = [poll_id.to_le_bytes().as_ref(),candidate_name.as_bytes()], // Seed Derivation Depends on Argument Order:
        bump
    )]
    pub candidate_account: Account<'info, Candidate>,
    #[account(mut)]
    // In this specific case, the #[account(mut)] for signer is required because the signer is used as the payer for initializing the candidate_account.
    pub signer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(poll_id: u64, candidate_name: String)] // depend on function argument

pub struct InitializeVote<'info> {
    #[account(
        seeds = [poll_id.to_le_bytes().as_ref()],
        bump
    )]
    #[account(mut)]
    pub poll_account: Account<'info, Poll>,

    #[account(
        seeds = [poll_id.to_le_bytes().as_ref(), candidate_name.as_bytes()],
        bump
    )]
    #[account(mut)]
    pub candidate_account: Account<'info, Candidate>,

    #[account(
        init,
        payer = signer,
        space = 8 + 8 + 32, //// 8 bytes for discriminator + 32 bytes for Pubkey
        seeds = [poll_id.to_le_bytes().as_ref(),signer.key().as_ref()], // The PDA for the Voter account is derived from the poll_id and the voter’s public key (signer.key()), ensuring that each user can only have one Voter account per poll.
        // poll_id.to_le_bytes(): Represents the unique identifier of the poll.
        // signer.key(): Represents the unique identifier of the voter (their public key).
        // PDA Uniqueness: The combination of these two ensures that:
        // Each poll has a unique voter_account for every voter.
        bump
    )]
    // Since the voter_account PDA is derived based on these two inputs, the uniqueness of the account ensures that a single user can only have one voter_account per poll. This means:
    //The existence of the voter_account serves as proof that the user has already voted.
    //  when each user voted, our program store that action in an account, in our case is  a PDA account, and that one is unique, when user try one more time, the error will happen
    pub voter_account: Account<'info, Voter>,

    // When the voter_account is initialized using the #[account(init)] constraint, Anchor:
    // Derives the PDA using the seeds provided.
    // Checks if the account already exists.
    // If the account already exists, the transaction fails automatically.
    // On the first vote:
    // The voter_account is initialized (created) and tied to the poll_id and signer.key().
    // The program stores the voter's details (e.g., their public key) in the voter_account.
    // The candidate's vote count is incremented.
    // Second Time Voting

    // When the voter tries to vote again:
    // Anchor attempts to initialize the voter_account again using the same PDA.
    // Since the account already exists, the transaction fails due to the PDA uniqueness constraint.

    // reason this signer does not have accounts(mut)
    //The #[account(mut)] attribute is used when the account’s data or lamports
    //are modified during the function. The signer in the EndPoll function serves
    // only as an authorization check and does not undergo any changes.
    #[account(mut)]
    pub signer: Signer<'info>,
    // because we not init a new account here, we not have to define system_program
    pub system_program: Program<'info, System>,
}

// program custom error
#[error_code]
pub enum CustomError {
    #[msg("Poll account mismatch")]
    PollMismatch,

    #[msg("Poll has not started")]
    PollNotActive,
    #[msg("Only owner can perform this action")]
    Unauthorized,
    #[msg("You have already voted in this poll.")]
    AlreadyVoted,
}

// add ownership
// Poll Creation: Only the creator should be able to end their poll or add candidates to it.
// Candidate Initialization: Only the poll creator can add candidates.
// Voting: Any valid signer can vote, but each voter should only vote once.
// we can set owner in account context with owner =
