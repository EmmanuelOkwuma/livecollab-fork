# LiveCollab — Final Product, AI & Monetization Principles

This should be the source-of-truth model for the other chat. The key idea is: LiveCollab is a multiplayer workspace first, with shared AI teammates operating inside that workspace. Billing is per human seat; AI teammates belong to the room, not to individual users.

## 1. Core product principle

LiveCollab = a multiplayer software-development workspace where humans and AI teammates work on the same project in real time.

The fundamental unit is the room, not the individual user.

A room contains:

* Shared codebase
* Shared virtual filesystem
* Shared presence
* Shared communication
* Shared AI teammates
* Shared agent context
* Shared task/activity history
* Eventually shared execution environments

The goal is not:

"Give every developer their own AI assistant."

The goal is:

"Give the entire engineering team AI teammates that participate in the same workspace."

That distinction should remain fundamental.

## 2. The multiplayer-AI principle

LiveCollab should follow this rule:

An AI teammate is a participant in the room, not a private assistant owned by one user.

If Emmanuel creates Atlas, Atlas belongs to the room.

Chelsea doesn't need to create another Atlas.

If Chelsea summons Atlas, she is interacting with the same logical teammate that Emmanuel can interact with.

Example:

Emmanuel:

Atlas, investigate why authentication is failing.

Atlas starts investigating.

Chelsea sees it happening.

Chelsea can say:

Atlas, also check whether the socket authentication middleware is contributing to this.

Atlas incorporates that into the same room-level task/context.

That is multiplayer AI.

## 3. Shared context principle

The AI should understand the room's shared state, not just the individual who summoned it.

Its context can include:

* Current files
* Relevant code
* Recent changes
* Chat
* Previous agent actions
* Human instructions
* Other agent activity
* Task history
* Room configuration

Therefore:

If Emmanuel says:

"Don't modify the authentication middleware until we've reviewed the issue."

and Chelsea tells Atlas:

"Go ahead and modify the authentication middleware."

Atlas shouldn't blindly treat Chelsea's command as overriding Emmanuel.

Instead, the agent should recognize a conflicting instruction:

"Emmanuel previously asked me not to modify the authentication middleware until the issue was reviewed. Chelsea is now asking me to modify it. Should I proceed?"

The humans resolve the conflict.

That is much closer to an actual teammate than:

User → prompt → obedient chatbot.

## 4. AI teammate principle

Users should eventually be able to create specialized teammates.

For example:

Atlas

Role: Authentication Engineer

Instructions:

Investigate authentication issues, review Clerk integration, socket authentication, sessions, and related security problems.

Roxy

Role: Code Reviewer

Instructions:

Review changes for bugs, security problems, architectural issues, and maintainability.

Sam

Role: Testing Engineer

Instructions:

Run tests, investigate failures, reproduce bugs, and propose fixes.

These agents are room-level entities.

Everyone authorized in the room can summon them.

## 5. Agent concurrency principle

Atlas should not become:

Emmanuel's Atlas OR Chelsea's Atlas.

The same logical agent can handle multiple tasks.

Conceptually:

Atlas

* Task A → Emmanuel
* Task B → Chelsea
* Task C → Sam

The underlying infrastructure can execute these tasks concurrently where safe.

The agent's identity and long-term context remain shared, while individual tasks can have isolated execution contexts when necessary.

This prevents the absurd situation where:

"Sorry, Atlas is currently being used by Chelsea."

At the same time, LiveCollab should not blindly let two agents modify the same lines simultaneously. The system needs task/file awareness, locking or conflict detection, and human approval where appropriate.

## 6. Agent orchestration principle

LiveCollab's long-term orchestration should be multiplayer-native.

Instead of the traditional:

One engineer → 10 tabs → 10 independent agents

LiveCollab aims toward:

Multiple engineers → one room → multiple specialized agents → shared workspace

So you could have:

Emmanuel + Chelsea + Marcus

working alongside:

Atlas + Roxy + Sam

All inside one room.

Atlas handles authentication.

Roxy reviews the changes.

Sam runs tests.

Everyone sees the activity.

That is more aligned with LiveCollab's fundamental thesis than simply copying the "10 agents in 10 tabs" model.

## 7. Subscription principle

This is where the distinction between human identity and AI identity becomes extremely important.

Humans have subscriptions.

AI teammates do not have individual subscriptions.

A user's subscription determines the AI usage entitlement available to that human.

But the AI teammate itself belongs to the room.

So:

Emmanuel — Pro seat

can authorize premium AI usage.

Chelsea — Free seat

may only have access to the base/fallback capability.

But both can still see and interact with Atlas.

## 8. The AI doesn't become "Emmanuel's AI" because Emmanuel paid

This is critical.

Payment determines:

What level of AI computation this user is entitled to initiate/use.

It does not determine:

Who owns Atlas.

Atlas belongs to the room.

That preserves the multiplayer model.

## 9. Usage entitlement principle

Each human seat has its own usage allowance.

Example:

| Member | Plan | Premium allowance |
|---|---|---|
| Emmanuel | Pro | Available |
| Chelsea | Pro | Available |
| Marcus | Free | Limited |
| Sarah | Pro | Available |

If Emmanuel exhausts his premium allowance:

Emmanuel's AI entitlement changes.

It does not cause Atlas to disappear from the room.

It does not consume Chelsea's allowance.

It does not downgrade Atlas globally for everyone.

Chelsea can continue using premium capability according to her own entitlement.

Marcus continues using the base capability.

## 10. Running-task principle

This is an important rule to establish now.

A task should be associated with the authorization that started it.

If Emmanuel starts a premium task:

"Atlas, refactor the authentication system."

and Emmanuel's premium allowance subsequently runs out, LiveCollab should not silently charge Chelsea.

The task should either:

1. Continue under the usage authorization already granted to that task, if the economics and provider terms permit it; or
2. Pause/request authorization; or
3. Fall back to an allowed model if the task can safely continue.

But never silently transfer the cost to another member.

That prevents billing abuse and preserves trust.

## 11. Model principle

Don't think of the system as:

Every user has an AI.

Think:

The room has AI capability, while each user has an authorization level for using that capability.

The room can select its available brain/model configuration.

For example:

Room Brain

* LiveCollab Base
* LiveCollab Premium
* Claude
* GPT
* Other supported models

But the actual backend architecture should separate:

Model
→ the underlying foundation model/API

Agent
→ a persistent role/personality/instruction set

Task
→ a specific piece of work given to an agent

Room
→ the shared environment/context

User entitlement
→ what computation that user is allowed to initiate

Those are five different concepts.

## 12. LiveCollab-branded models

The idea of:

LiveCollab Base
LiveCollab Premium

is viable as a product abstraction.

The user doesn't necessarily need to care that LiveCollab Premium currently routes to Model X.

Your backend can determine which underlying model provides the capability.

However, don't falsely imply that LiveCollab trained or created the underlying foundation model if it didn't.

Think of it as a LiveCollab AI tier/model experience, not necessarily a proprietary foundation model.

## 13. Fallback principle

The fallback model exists to prevent users from hitting a brick wall.

If a member's premium allowance is exhausted:

Premium capability → Base capability

rather than:

AI → completely disabled

This is good for retention because the user can continue working.

But the base model needs to be economically controlled.

## 14. Monetization principle

The business model should be:

Seats + metered AI usage + enterprise

Not:

"We sell access to an AI."

You sell access to the collaborative engineering workspace.

AI is a major value component and a variable cost.

Therefore:

Seat revenue

Every human who needs their own AI entitlement has a seat.

For example:

Free

* Join rooms
* Collaborate
* Limited/base AI

Pro

* Premium AI access
* Larger usage allowance
* Advanced capabilities

Pro+ / Max

* Larger allowances
* Higher limits
* Heavy-user capabilities

Enterprise

* Team-level controls
* Pooled usage
* Security/compliance
* Self-hosted/private infrastructure options
* Provenance
* Administrative controls

The exact prices should be validated against actual usage rather than treated as permanent today.

## 15. AI cost principle

The user does not need to know your internal API economics.

LiveCollab's backend handles this.

You calculate:

Revenue per seat − expected AI/API cost − infrastructure cost = gross margin.

The fallback system exists partly to control that cost.

For example, you could have:

Free user
→ inexpensive model
→ small controlled allowance

Paid user
→ premium model access
→ controlled premium allowance

If someone consumes their allowance:

→ base capability remains available.

You do not promise unlimited expensive inference.

## 16. Top-up principle

Like the behavior you described with Claude:

Subscription ≠ unlimited AI.

A subscription gives a defined allowance.

When that allowance is exhausted:

Buy additional usage if desired.

So LiveCollab can eventually have:

Pro
→ monthly premium allowance

Usage exhausted
→ Base AI remains available

Need more premium
→ Buy additional usage/top-up

This creates another revenue stream without requiring you to make the subscription unlimited.

## 17. Why this monetization doesn't destroy multiplayer AI

This is the part that initially caused the confusion.

You do not need ten people to split one subscription.

Instead:

The room is shared.
AI identity is shared.
Human billing is individualized.

That's the principle.

Ten people can collaborate with the same Atlas.

But each person's entitlement is independently determined.

So the multiplayer experience remains shared while billing remains economically manageable.

## 18. What happens when people disagree?

The AI should operate under shared room context + explicit human attribution.

For example:

Emmanuel:

Don't modify auth.ts.

Chelsea:

Modify auth.ts to fix the login issue.

Atlas:

"I have conflicting instructions. Emmanuel previously asked me not to modify auth.ts, while Chelsea is now asking me to modify it. I found the likely issue at line 143. I can prepare the fix without applying it. Should I proceed?"

Then humans decide.

This is actually an important part of making the AI feel like a teammate rather than an obedient chatbot.

## 19. Code-change principle

AI should preferably propose before committing consequential changes.

The ideal UX is:

Atlas finds problem

→ identifies exact file
→ identifies exact location
→ explains problem
→ proposes change
→ highlights problematic code
→ highlights proposed fix
→ humans review
→ approve/reject

Everyone in the room can see this.

That makes the AI's work collaborative and auditable.

## 20. Provenance principle

Eventually every meaningful change should have attribution:

H: Emmanuel
Human: Chelsea
Agent: Atlas
Agent: Roxy

And LiveCollab can eventually answer:

Who changed this line?

Why was it changed?

Which agent proposed it?

Who approved it?

What did the code look like before?

That becomes increasingly valuable as AI-generated code becomes normal.

## 21. BYOK principle

Do not make BYOK the core LiveCollab AI model.

Your concern is valid.

If everyone simply plugs their personal Claude/GPT API key into independent agents, you risk turning LiveCollab into an orchestration shell around individual AI accounts.

That weakens your core thesis:

shared multiplayer AI

BYOK could eventually exist as an optional advanced feature, particularly for developers/enterprise customers who explicitly want it.

But it should not replace the core LiveCollab AI experience.

## 22. Solo/private work

LiveCollab can still support one person working alone.

But the architecture shouldn't become:

"LiveCollab is primarily a single-player AI IDE, and multiplayer is an extra."

It should remain:

LiveCollab is a multiplayer workspace that also works when only one human is present.

That preserves the product identity.

## 23. The ultimate product loop

The fundamental LiveCollab loop becomes:

Create room

↓

Invite humans

↓

Create/select AI teammates

↓

Humans + agents work on the same codebase

↓

Agents perform tasks

↓

Everyone sees their work

↓

Humans review/redirect/approve

↓

Changes become part of shared project history

↓

Agents can continue working asynchronously

↓

Humans return, review results, and assign the next tasks

That is the product.

## 24. The one-sentence principle

If you need to explain the entire company in one sentence:

LiveCollab is a multiplayer software-development workspace where humans and shared AI teammates work on the same codebase, with each human having their own usage entitlement while the AI itself belongs to the shared room.

And the business principle:

We monetize human seats and metered AI usage, not ownership of individual AI teammates; the room and its agents are shared, while authorization and billing remain per human.

And the technical principle:

Separate room state, agent identity, task execution, model selection, and user entitlement so that shared AI can remain multiplayer without turning billing and resource consumption into a shared-account problem.

That should be the canonical LiveCollab model going forward.
