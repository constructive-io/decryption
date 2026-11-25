/**
 * Files a workspace's repository needs, ready to paste. `dcrypt guard snippet <name>` prints one.
 */

/** Marks a pre-commit hook as ours, so that installing again replaces it and nothing else. */
export const HOOK_MARKER = '# dcrypt-guard';

const gitignore = `# Allow-list: ignore everything, then name what may be committed.
# A new file is private until a line here says otherwise.
/*
!/.gitignore
!/.gitattributes
!/README.md
!/recipients.txt
!/*.tar.dcrypt

# For bundles in a sub-folder, open the folder, close its contents, allow its bundles:
# !/clients/
# /clients/*
# !/clients/*.tar.dcrypt
`;

const gitattributes = `# Bundles are large and change completely on every encryption: keep them in Git LFS.
*.tar.dcrypt filter=lfs diff=lfs merge=lfs -text
`;

const hook = `#!/bin/sh
${HOOK_MARKER}: installed by "dcrypt guard install"
# Refuses a commit that would record plaintext from an encrypted section.
if ! command -v dcrypt >/dev/null 2>&1; then
  echo "pre-commit: dcrypt is not installed, so this commit cannot be checked." >&2
  echo "pre-commit: install it with: npm i -g @decryption/cli" >&2
  exit 1
fi
exec dcrypt guard --staged
`;

const ci = `# A step for CI: fails the build if plaintext was ever committed.
- name: dcrypt guard
  run: npx --yes @decryption/cli guard --all
`;

const recipients = `# Who can decrypt the sections in this folder. One public key per line, then a label.
# Public keys are safe to commit. "dcrypt keys show" prints yours.
#
# Keep one key that lives on no working machine, with "recovery" in its label:
# it is what opens the sections on the day every laptop is gone.
#
# dcrypt1…  ada (laptop)
# dcrypt1…  ada (desktop)
# dcrypt1…  recovery (printed, in the safe)
`;

export const SNIPPETS = {
  gitignore: { file: '.gitignore', text: gitignore },
  gitattributes: { file: '.gitattributes', text: gitattributes },
  hook: { file: '.git/hooks/pre-commit', text: hook },
  ci: { file: 'a CI workflow', text: ci },
  recipients: { file: 'recipients.txt', text: recipients },
} as const;

export type SnippetName = keyof typeof SNIPPETS;

export const isSnippetName = (name: string): name is SnippetName => Object.hasOwn(SNIPPETS, name);
