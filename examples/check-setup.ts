import { Cursor } from '@cursor/sdk';

async function main() {
  const user = await Cursor.me();
  const models = await Cursor.models.list();

  console.log('Cursor API key is valid.');
  console.log(`API key name: ${user.apiKeyName}`);

  if (user.userEmail !== undefined) {
    console.log(`User email: ${user.userEmail}`);
  }

  console.log('\nAvailable models:');
  for (const model of models.slice(0, 10)) {
    console.log(`- ${model.id}: ${model.displayName}`);
  }

  if (models.length > 10) {
    console.log(`...and ${models.length - 10} more`);
  }
}

main().catch((error: unknown) => {
  console.error('Setup check failed:', error);
  console.error('\nMake sure CURSOR_API_KEY is set.');
  process.exitCode = 1;
});
