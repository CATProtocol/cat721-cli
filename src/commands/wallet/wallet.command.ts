import { Command, CommandRunner } from 'nest-commander';
import { AddressCommand } from './address.command';
import { CreateCommand } from './create.command';
import { ImportCommand } from './import.command';
import { logerror } from 'src/common';
import { BalanceCommand } from './balance.command';
interface WalletCommandOptions {}

@Command({
  name: 'wallet',
  arguments: '<subcommand>',
  description: 'Wallet commands',
  subCommands: [AddressCommand, CreateCommand, ImportCommand, BalanceCommand],
})
export class WalletCommand extends CommandRunner {
  async run(
    passedParams: string[],
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    options?: WalletCommandOptions,
  ): Promise<void> {
    if (passedParams[0]) {
      logerror(`Unknow subCommand \'${passedParams[0]}\'`, new Error());
      return;
    }
  }
}
