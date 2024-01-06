import {
	AnySelectMenuInteraction,
	ButtonInteraction,
	Client,
	Collection,
	Interaction as DInteraction,
	ModalSubmitInteraction
} from 'discord.js';
import { readdir } from 'fs/promises';
import { join } from 'path';
import {
	ChatInputCommand, ContextMenuCommand, Event, Interaction
} from '.';
import { logger } from '..';
import interactionCreate from '../events/interactionCreate';
import {
	ExtendedClientOptions,
	TypeCommand, initOptions, tsNodeRun
} from '../util';
import { CommandHandler } from './Handlers/CommandHandler';
import { EventHandler } from './Handlers/EventHandler';
import { InteractionHandler } from './Handlers/InteractionHandler';

/**
 * ExtendedClient is extended from the {@import ('discord.js').Client}.
 * @see {@link https://discord.js.org/#/docs/main/stable/class/Client}
 */
export class ExtendedClient extends Client<true> {

	readonly eventHandler = new EventHandler(this);

	readonly commandHandler = new CommandHandler(this);

	readonly interactionHandler = new InteractionHandler(this);

	// Whether the bot should responded to buttons or select menus
	readonly receiveMessageComponents: boolean;

	// Whether the bot should responded to modals
	readonly receiveModals: boolean;

	// Whether the bot should responded to autocomplete
	readonly receiveAutocomplete: boolean;

	// Whether the bot should responded to autocomplete
	readonly replyOnError: boolean;

	// Whether the bot should split interactions' custom ids (Recommended `true`)
	readonly splitCustomID: boolean;

	// The sting that is used to split the custom id
	readonly splitCustomIDOn: string;

	// Should bot push guild specific commands at start up
	readonly useGuildCommands: boolean;

	// Checks if the init function has run
	private _hasInitRun = false;

	get logedIn() {
		return this._hasInitRun;
	}

	/**
	 *
	 * @param options Options for the client
	 * @see https://discord.js.org/#/docs/discord.js/main/typedef/ClientOptions
	 */
	constructor(options: ExtendedClientOptions) {
		super(options);

		logger.info('Client starting up...');

		// Paths
		const {
			receiveMessageComponents, receiveModals, receiveAutocomplete, replyOnError, splitCustomID, splitCustomIDOn, useGuildCommands 
		} = options;

		// MICS configuration
		this.receiveMessageComponents = receiveMessageComponents === undefined ? false : receiveMessageComponents;
		this.receiveModals = receiveModals === undefined ? false : receiveModals;
		this.receiveAutocomplete = receiveAutocomplete === undefined ? false : receiveAutocomplete;
		this.replyOnError = replyOnError === undefined ? false : replyOnError;
		this.splitCustomID = splitCustomID === undefined ? false : splitCustomID;
		this.useGuildCommands = useGuildCommands === undefined ? false : useGuildCommands;
		this.splitCustomIDOn = splitCustomIDOn || '_';

		// Add interaction event listener for built in interaction handler
		this.eventHandler.add(interactionCreate);
	}

	/**
	 * Loads event, command and interaction files in to the client
	 * @param options file paths where event, command and interaction files are
	 * @returns the client object without the init method
	 */
	public async init(options: initOptions) {
		logger.debug('Client initializing...');

		// load in dependate event, command and interaction files
		await Promise.all([
			this.loadEvents(options.eventPath),
			this.loadCommands(options.commandPath),
			this.loadContextMenus(options.contextMenuPath),
			this.loadButtons(options.buttonPath),
			this.loadSelectMenus(options.selectMenuPath),
			this.loadModals(options.modalPath)
		]);

		// update private init flag
		this._hasInitRun = true;

		logger.debug('Client initialized');

		// return this object with init method omitted
		return this as Omit<ExtendedClient, 'init'>;
	}

	private async loadEvents(eventPath: string) {
		const dir = await readdir(eventPath);
		const files = dir.filter((file) => file.endsWith(tsNodeRun ? '.ts' : '.js'));

		for (const file of files) {
			const event = (await import(join(eventPath, file))).default as Event;

			this.eventHandler.add(event);
		}

		const numberOfEvents = this.eventHandler.size;
		logger.info(`Loaded ${numberOfEvents} events.`);
		return numberOfEvents;
	}

	private async loadButtons(path?: string) {
		// Button Handler
		if (path) {
			this.interactionHandler.addButtons(await this.fileToCollection<Interaction<ButtonInteraction>>(path));
		}
	}

	private async loadModals(path?: string) {
		// Modal Handler
		if (path) {
			this.interactionHandler.addModals(await this.fileToCollection<Interaction<ModalSubmitInteraction>>(path));
		}
	}

	private async loadSelectMenus(path?: string) {
		// Select Menu Handler
		if (path) {
			this.interactionHandler.addSelectMenus(await this.fileToCollection<Interaction<AnySelectMenuInteraction>>(path));
		}
	}

	private async loadContextMenus(path?: string) {
		// Context Menu Handler
		if (path) {
			this.commandHandler.addContextCommands(await this.fileToCollection<ContextMenuCommand>(path));
		}
	}

	private async loadCommands(path?: string) {
		this.commandHandler.addChatCommands(await this.fileToCollection<ChatInputCommand>(path));
	}

	/**
	 * Login to the Discord WS
	 * @param token The bot's Discord token
	 * @returns string response
	 */
	public async login(token?: string) {
		logger.debug('Start of login called');

		if (!this._hasInitRun) {
			throw Error('[ERROR] client.init() has not been completed');
		}

		if (!token) {
			throw new Error('[ERROR] Missing token');
		}

		logger.debug('Initializing login');

		return super.login(token);
	}

	/**
	 * Converts Commands and Interactions in to Collection objects
	 * @param dirPath Root directory of object
	 * @returns Collection of Type
	 */
	private async fileToCollection<Type extends TypeCommand | Interaction<DInteraction>>(dirPath: string): Promise<Collection<string, Type>> {
		// collection that will be returned
		const collection = new Collection<string, Type>();

		try {
			// Array of Directory entities including the file type
			const dirents = await readdir(dirPath, { withFileTypes: true });

			// For Each file in the Array of Directory entitys where the file ends in ts or js based on the environment
			for (const file of dirents.filter((dirent) => !dirent.isDirectory() && dirent.name.endsWith(tsNodeRun ? '.ts' : '.js'))) {
				// Import the file noting the default object
				const resp: { default: Type } = await import(join(dirPath, file.name));

				// Get name of file
				const name =
					('builder' in resp.default !== undefined && (resp.default as TypeCommand).builder?.name) ||
					(resp.default as Interaction<DInteraction>)?.name;

				if (!name) {
					throw new Error(`[ERROR] ${file.name} is missing a name`);
				}

				// Add object to the collection
				collection.set(name, resp.default);
			}

			// For Each Directory in the Array of Directory entities
			for (const dir of dirents.filter((dirent) => dirent.isDirectory())) {
				// Get the complete filepath
				const directoryPath = join(dirPath, dir.name);
				// Get subfolder contects
				const dirFiles = await readdir(directoryPath);

				// For Each file in the Array of Directory entities where the file ends in ts or js based on the environment
				for (const file of dirFiles.filter((f) => f.endsWith(tsNodeRun ? '.ts' : '.js'))) {
					// Import the file noting the default object
					const resp: { default: Type } = await import(join(directoryPath, file));

					// Get name of file
					const name =
						'builder' in resp.default !== undefined ? (resp.default as TypeCommand).builder.name : (resp.default as Interaction<DInteraction>).name;

					// Add object to the collection
					collection.set(name, resp.default);
				}
			}
		}
		catch (error) {
			// catch errors relating to a file destination not existing as they are not fatal to the function of the Client
			if (this.isErrnoException(error) && error.code === 'ENOENT' && error.syscall === 'scandir') {
				logger.warn(`Directory not found at ${error.path}`);
			}
			else {
				throw error;
			}
		}

		return collection;
	}

	/**
	 * Returns a boolean and Types a unknown as ErrnoException if the object is an error
	 * @param error Any unknown object
	 * @returns A boolean value if the the object is a ErrnoException
	 */
	// eslint-disable-next-line no-undef
	private isErrnoException(error: unknown): error is NodeJS.ErrnoException {
		return error instanceof Error;
	}
}

declare module 'discord.js' {
	interface BaseInteraction {
		client: ExtendedClient;
	}
	interface Component {
		client: ExtendedClient;
	}
	interface Message {
		client: ExtendedClient;
	}
	interface BaseChannel {
		client: ExtendedClient;
	}
	interface Role {
		client: ExtendedClient;
	}
	interface Guild {
		client: ExtendedClient;
	}
	interface User {
		client: ExtendedClient;
	}
	interface GuildMember {
		client: ExtendedClient;
	}
}
