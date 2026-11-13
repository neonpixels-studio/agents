# Splits PR/issue feedback into what a worker may see and what it may not.
#
# Input:  one array of items from any mix of the REST endpoints
#         pulls/<n>/comments, pulls/<n>/reviews, and issues/<n>/comments.
# Args:   --argjson bots '<array of bot logins to trust>'
#         --arg agent '<the agent account login>'
# Output: {trusted: [...], dropped: {users: <n>, bots: <n>}}
#
# The agent's own comments (review trails, acknowledgements) are neither
# feedback nor untrusted, so they are left out entirely. Empty bodies (a bare
# approval) carry no instructions and are skipped too.

def trusted_association: .author_association | IN("OWNER", "MEMBER", "COLLABORATOR");
def allowlisted_bot($bots): .user.login | IN($bots[]);
def trusted($bots): trusted_association or allowlisted_bot($bots);
def has_text: (.body // "") | test("\\S");
def is_bot: .user.type == "Bot";

def normalized:
  {
    id,
    author: .user.login,
    posted_at: (.submitted_at // .created_at),
    review_state: .state,
    path,
    line: (.line // .original_line),
    body
  };

map(select(has_text and .user.login != $agent))
| {
    trusted: map(select(trusted($bots)) | normalized),
    dropped: {
      users: map(select((trusted($bots) | not) and (is_bot | not))) | length,
      bots: map(select((trusted($bots) | not) and is_bot)) | length
    }
  }
