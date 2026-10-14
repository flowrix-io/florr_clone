# Flowrix Commercial Hosting License — draft 2

**NOT ACTIVE. This is a proposed agreement for a future release with cleared rights.**
The current project remains under the root LICENSE (AGPL-3.0-or-later).
This draft does not restrict existing AGPL rights, replace third-party licenses,
or grant rights to material the licensor does not own. It is a custom commercial
license, not Apache-2.0 and not an open-source license.

## Activation and scope

Before adoption, fill in the licensor's legal name, contact, payment instructions,
governing law and forum, and a precise release/file manifest of covered material.
Obtain alternative licensing permission from every relevant rights holder or
replace incompatible third-party material with independently created material.
Have counsel review the completed agreement. Adoption requires a separate,
explicit release notice; publishing this draft alone does not activate it.

Licensor: [legal name and address]
Contact: [licensing contact]
Covered material: [release, commit and file manifest]
Effective date: [date]
Payment instructions and reporting address: [details]
Governing law and courts: [jurisdiction and forum]

## 1. Permissions

Subject to this agreement, the licensor grants a worldwide, non-exclusive license
to use, inspect, modify, reproduce, distribute and host the covered material.
Recipients must receive this agreement and retained copyright notices. They
obtain their permission directly from the licensor under the same terms.
No recipient may grant broader rights or remove these conditions. Private use
and hosting that generates no covered revenue owe no royalty.

## 2. Hosting royalty

Operators owe **20% of covered revenue**, payable monthly within 30 days after
each calendar month. Covered revenue means money actually received by the
operator or its affiliates from the hosted game: access, Stars, virtual items,
subscriptions, memberships, advertising, sponsorships and game-linked donations.
Subtract only separately collected sales/VAT taxes remitted to authorities,
actual refunds and chargebacks. Payment-processing fees, hosting costs, wages
and other expenses are not deductible. Unrelated business revenue is excluded.
Receipts in other currencies are converted to USD at the operator's payment
processor's settlement rate; if none is available, use an identified published
daily rate consistently and disclose it in the statement.

Bundles must allocate revenue reasonably to the game using standalone prices,
or a documented reasonable allocation if no standalone prices exist. Routing
receipts through another entity, renaming payments as donations or splitting
the service does not remove the royalty obligation.

For each month of public operation, send a statement identifying service URLs,
covered receipts, deductions, conversion rates and the royalty due, including
zero-revenue months after monetization begins. A completely free operator need
only register its service URL and contact before public hosting, and report
when monetization begins. Keep supporting records for three years. The licensor may
request a confidential review by an independent accountant once per year on
30 days' notice; the licensor pays unless underpayment exceeds 5%, in which
case the operator reimburses reasonable review costs. Reviews must minimize
access to players' personal data and exclude unrelated business records.

Example: $1,000 in game receipts, minus $50 in remitted sales tax and $50 in
refunds, produces $900 of covered revenue and a $180 royalty. Hosting and
processing expenses do not reduce that amount. Royalties are owed to the
licensor, never to contributors or third parties unless separately agreed.

The licensor may grant a written waiver or a separate commercial agreement.
An operator must not represent a fork as the official Flowrix service or
suggest that its purchases benefit the original creator beyond the actual
royalty. This agreement does not promise that any hosting operation will earn
revenue and does not automatically collect royalties.

## 3. Visible credit

Every public client must visibly display **“Powered by Flowrix · Original project
by [approved creator name]”**, linked to [official project URL], on the main
menu or landing screen without opening a submenu. Credit must be readable on
desktop and mobile, with normal contrast and a size comparable to surrounding
UI text. Do not hide it behind a tooltip, overlay or transparent styling.
Retain source copyright and third-party attribution notices and identify
modified distributions as unofficial. No trademark ownership or endorsement
is granted; project names may be used for the required attribution only.

## 4. Restricted providers

Amazon/AWS, Microsoft/Azure, Google/Google Cloud, Alibaba Cloud, Tencent Cloud,
Oracle Cloud and IBM Cloud, and entities they control or that control them,
may not operate, resell or offer the covered game as their own hosted service,
managed game product or commercial distribution without a separate signed
license from the licensor. Control means majority ownership or effective power
to direct management. Operating through a controlled entity does not avoid
this restriction.

**Ordinary independent operators may rent infrastructure from these providers.**
The restriction concerns providers offering the game themselves, not customers
using their compute, storage or networking services. This is the interpretation
chosen for this draft; a ban on all deployments on their infrastructure would
require different wording.

## 5. Contributions and third-party material

Contributors keep ownership of their contributions. Incorporating a contribution
does not automatically give the licensor rights to relicense it; obtain an
explicit contribution agreement for any intended commercial relicensing.
Third-party components remain subject to their own licenses. These terms do
not override them. Material with incompatible licensing must not be included
in the covered release without separate permission.

## 6. Breach and termination

On written notice of a breach, the operator has 30 days to cure it, including
paying outstanding royalties. If not cured, permissions under this agreement
terminate and the operator must stop hosting and distributing covered material.
Accrued payment, reporting and record-retention obligations survive termination.
Compliant downstream recipients retain their own rights under this agreement.
Independent rights granted under other licenses remain unaffected. Changes to
future versions of these terms do not retroactively change this agreement.

## 7. Warranty and liability

To the extent permitted by applicable law, the covered material is provided
as-is without warranties of merchantability, fitness or non-infringement.
The licensor is not liable for indirect, incidental or consequential damages.
Nothing excludes liability or rights that applicable law makes non-excludable.
No support, hosting, uptime or security maintenance is promised.

## Practical summary

- People can modify and host a rights-cleared release.
- Free hosting owes $0; monetized hosting pays 20% of covered receipts after
  taxes, refunds and chargebacks, with monthly reporting.
- Clear credit stays visible on the main screen.
- Named major cloud providers need a separate deal to offer the game themselves;
  independent hosts can still rent their infrastructure.
- Current AGPL releases retain their existing freedoms. This draft cannot
  impose these restrictions on them.

References: [current project license](LICENSE),
[Apache-2.0 royalty-free grant](https://www.apache.org/licenses/LICENSE-2.0),
[AGPLv3 sections 7, 10 and 13](https://www.gnu.org/licenses/agpl-3.0.html).
