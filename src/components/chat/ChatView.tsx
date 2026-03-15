import { ItemView, WorkspaceLeaf, Platform, Notice, Menu } from "obsidian";
import type {
	IChatViewContainer,
	ChatViewType,
} from "../../domain/ports/chat-view-container.port";
import * as React from "react";
const { useState, useRef, useEffect, useCallback } = React;
import { createRoot, Root } from "react-dom/client";

import type AgentClientPlugin from "../../plugin";
import type { ChatInputState } from "../../domain/models/chat-input-state";

// Component imports
import { ChatHeader } from "./ChatHeader";
import { ChatMessages } from "./ChatMessages";
import { ChatInput } from "./ChatInput";
// Utility imports
import { getLogger, Logger } from "../../shared/logger";

// Adapter imports
import type { IAcpClient } from "../../adapters/acp/acp.adapter";

// Hooks imports
import { useChatController } from "../../hooks/useChatController";
import { useSettings } from "../../hooks/useSettings";
import { useSessionTabs } from "../../hooks/useSessionTabs";

// Component imports (tabs)
import { ChatTabBar } from "./ChatTabBar";

// Domain model imports
import type { ImagePromptContent } from "../../domain/models/prompt-content";

// Type definitions for Obsidian internal APIs
interface AppWithSettings {
	setting: {
		open: () => void;
		openTabById: (id: string) => void;
	};
}

export const VIEW_TYPE_CHAT = "agent-client-chat-view";

// ============================================================================
// ChatTabContent - Per-tab chat session (extracted from original ChatComponent)
// ============================================================================

/**
 * Content component for a single tab within ChatView.
 * Each instance owns its own useChatController → independent agent process.
 */
function ChatTabContent({
	plugin,
	view,
	viewId,
	tabViewId,
	isActive,
	initialAgentId,
	onAgentChange,
	onFirstMessage,
}: {
	plugin: AgentClientPlugin;
	view: ChatView;
	viewId: string;
	tabViewId: string;
	isActive: boolean;
	/** Initial agent ID from workspace state restoration */
	initialAgentId?: string;
	/** Called when agent switches in this tab (for tab title update) */
	onAgentChange: (agentLabel: string, agentId: string) => void;
	/** Called when first message is sent (for tab title update) */
	onFirstMessage: (messagePreview: string) => void;
}) {
	// ============================================================
	// Chat Controller Hook (Centralized Logic)
	// ============================================================
	const controller = useChatController({
		plugin,
		viewId: tabViewId,
		initialAgentId,
	});

	const {
		acpAdapter,
		settings,
		session,
		isSessionReady,
		messages,
		isSending,
		isUpdateAvailable,
		permission,
		mentions,
		autoMention,
		slashCommands,
		sessionHistory,
		activeAgentLabel,
		availableAgents,
		errorInfo,
		handleSendMessage,
		handleStopGeneration,
		handleNewChat,
		handleExportChat,
		handleRestartAgent,
		handleClearError,
		handleOpenHistory,
		handleSetMode,
		handleSetModel,
		inputValue,
		setInputValue,
		attachedImages,
		setAttachedImages,
		restoredMessage,
		handleRestoredMessageConsumed,
	} = controller;

	// ============================================================
	// Refs
	// ============================================================
	const acpClientRef = useRef<IAcpClient>(acpAdapter);

	// ============================================================
	// Notify parent when agent label changes
	// ============================================================
	useEffect(() => {
		onAgentChange(activeAgentLabel, session.agentId);
	}, [activeAgentLabel, session.agentId, onAgentChange]);

	// ============================================================
	// Notify parent on first user message (for tab title)
	// ============================================================
	const hasNotifiedFirstMessage = useRef(false);

	useEffect(() => {
		if (hasNotifiedFirstMessage.current) return;
		if (messages.length === 0) return;

		// Find the first user message
		const firstUserMsg = messages.find((m) => m.role === "user");
		if (!firstUserMsg) return;

		// Extract text from content (supports both "text" and "text_with_context")
		const textContent = firstUserMsg.content.find(
			(c) => c.type === "text" || c.type === "text_with_context",
		);
		if (
			textContent &&
			(textContent.type === "text" ||
				textContent.type === "text_with_context")
		) {
			hasNotifiedFirstMessage.current = true;
			onFirstMessage(textContent.text);
		}
	}, [messages, onFirstMessage]);

	// ============================================================
	// ChatView-specific Callbacks
	// ============================================================
	const handleNewChatWithPersist = useCallback(
		async (requestedAgentId?: string) => {
			await handleNewChat(requestedAgentId);
			if (requestedAgentId) {
				view.setAgentId(requestedAgentId);
			}
		},
		[handleNewChat, view],
	);

	const handleOpenSettings = useCallback(() => {
		const appWithSettings = plugin.app as unknown as AppWithSettings;
		appWithSettings.setting.open();
		appWithSettings.setting.openTabById(plugin.manifest.id);
	}, [plugin]);

	// ============================================================
	// Header Menu (Obsidian native Menu API)
	// ============================================================
	const handleShowMenu = useCallback(
		(e: React.MouseEvent<HTMLButtonElement>) => {
			const menu = new Menu();

			// -- Switch agent section --
			menu.addItem((item) => {
				item.setTitle("Switch agent").setIsLabel(true);
			});

			for (const agent of availableAgents) {
				menu.addItem((item) => {
					item.setTitle(agent.displayName)
						.setChecked(agent.id === (session.agentId || ""))
						.onClick(() => {
							void handleNewChatWithPersist(agent.id);
						});
				});
			}

			menu.addSeparator();

			// -- Actions section --
			menu.addItem((item) => {
				item.setTitle("Open new view")
					.setIcon("plus")
					.onClick(() => {
						void plugin.openNewChatViewWithAgent(
							plugin.settings.defaultAgentId,
						);
					});
			});

			menu.addItem((item) => {
				item.setTitle("Restart agent")
					.setIcon("refresh-cw")
					.onClick(() => {
						void handleRestartAgent();
					});
			});

			menu.addSeparator();

			menu.addItem((item) => {
				item.setTitle("Plugin settings")
					.setIcon("settings")
					.onClick(() => {
						handleOpenSettings();
					});
			});

			menu.showAtMouseEvent(e.nativeEvent);
		},
		[
			availableAgents,
			session.agentId,
			handleNewChatWithPersist,
			plugin,
			handleRestartAgent,
			handleOpenSettings,
		],
	);

	// ============================================================
	// Broadcast Command Callbacks (only active tab responds)
	// ============================================================
	/** Get current input state for broadcast commands */
	const getInputState = useCallback((): ChatInputState | null => {
		return {
			text: inputValue,
			images: attachedImages,
		};
	}, [inputValue, attachedImages]);

	/** Set input state from broadcast commands */
	const setInputState = useCallback(
		(state: ChatInputState) => {
			setInputValue(state.text);
			setAttachedImages(state.images);
		},
		[setInputValue, setAttachedImages],
	);

	/** Send message for broadcast commands (returns true if sent) */
	const sendMessageForBroadcast = useCallback(async (): Promise<boolean> => {
		if (!inputValue.trim() && attachedImages.length === 0) {
			return false;
		}
		if (!isSessionReady || sessionHistory.loading) {
			return false;
		}
		if (isSending) {
			return false;
		}

		const imagesToSend: ImagePromptContent[] = attachedImages.map(
			(img) => ({
				type: "image",
				data: img.data,
				mimeType: img.mimeType,
			}),
		);

		const messageToSend = inputValue.trim();
		setInputValue("");
		setAttachedImages([]);

		await handleSendMessage(
			messageToSend,
			imagesToSend.length > 0 ? imagesToSend : undefined,
		);
		return true;
	}, [
		inputValue,
		attachedImages,
		isSessionReady,
		sessionHistory.loading,
		isSending,
		handleSendMessage,
		setInputValue,
		setAttachedImages,
	]);

	/** Check if this view can send a message */
	const canSendForBroadcast = useCallback((): boolean => {
		const hasContent =
			inputValue.trim() !== "" || attachedImages.length > 0;
		return (
			hasContent &&
			isSessionReady &&
			!sessionHistory.loading &&
			!isSending
		);
	}, [
		inputValue,
		attachedImages,
		isSessionReady,
		sessionHistory.loading,
		isSending,
	]);

	/** Cancel current operation for broadcast commands */
	const cancelForBroadcast = useCallback(async (): Promise<void> => {
		if (isSending) {
			await handleStopGeneration();
		}
	}, [isSending, handleStopGeneration]);

	// Register callbacks with ChatView class for broadcast commands (only active tab)
	useEffect(() => {
		if (!isActive) return;

		view.registerInputCallbacks({
			getDisplayName: () => activeAgentLabel,
			getInputState,
			setInputState,
			sendMessage: sendMessageForBroadcast,
			canSend: canSendForBroadcast,
			cancel: cancelForBroadcast,
		});

		return () => {
			view.unregisterInputCallbacks();
		};
	}, [
		isActive,
		view,
		activeAgentLabel,
		getInputState,
		setInputState,
		sendMessageForBroadcast,
		canSendForBroadcast,
		cancelForBroadcast,
	]);

	// ============================================================
	// Effects - Workspace Events (Hotkeys)
	// ============================================================
	type CustomEventCallback = (targetViewId?: string) => void;

	useEffect(() => {
		const workspace = plugin.app.workspace;

		const eventRef = (
			workspace as unknown as {
				on: (
					name: string,
					callback: CustomEventCallback,
				) => ReturnType<typeof workspace.on>;
			}
		).on("agent-client:toggle-auto-mention", (targetViewId?: string) => {
			if (targetViewId && targetViewId !== viewId) {
				return;
			}
			if (!isActive) return;
			autoMention.toggle();
		});

		return () => {
			workspace.offref(eventRef);
		};
	}, [plugin.app.workspace, autoMention.toggle, viewId, isActive]);

	// Handle new chat request from plugin commands
	useEffect(() => {
		const workspace = plugin.app.workspace;

		const eventRef = (
			workspace as unknown as {
				on: (
					name: string,
					callback: (agentId?: string) => void,
				) => ReturnType<typeof workspace.on>;
			}
		).on("agent-client:new-chat-requested", (agentId?: string) => {
			if (
				plugin.lastActiveChatViewId &&
				plugin.lastActiveChatViewId !== viewId
			) {
				return;
			}
			if (!isActive) return;
			void handleNewChatWithPersist(agentId);
		});

		return () => {
			workspace.offref(eventRef);
		};
	}, [
		plugin.app.workspace,
		plugin.lastActiveChatViewId,
		handleNewChatWithPersist,
		viewId,
		isActive,
	]);

	useEffect(() => {
		const workspace = plugin.app.workspace;

		const approveRef = (
			workspace as unknown as {
				on: (
					name: string,
					callback: CustomEventCallback,
				) => ReturnType<typeof workspace.on>;
			}
		).on(
			"agent-client:approve-active-permission",
			(targetViewId?: string) => {
				if (targetViewId && targetViewId !== viewId) {
					return;
				}
				if (!isActive) return;
				void (async () => {
					const success = await permission.approveActivePermission();
					if (!success) {
						new Notice(
							"[Agent Client] No active permission request",
						);
					}
				})();
			},
		);

		const rejectRef = (
			workspace as unknown as {
				on: (
					name: string,
					callback: CustomEventCallback,
				) => ReturnType<typeof workspace.on>;
			}
		).on(
			"agent-client:reject-active-permission",
			(targetViewId?: string) => {
				if (targetViewId && targetViewId !== viewId) {
					return;
				}
				if (!isActive) return;
				void (async () => {
					const success = await permission.rejectActivePermission();
					if (!success) {
						new Notice(
							"[Agent Client] No active permission request",
						);
					}
				})();
			},
		);

		const cancelRef = (
			workspace as unknown as {
				on: (
					name: string,
					callback: CustomEventCallback,
				) => ReturnType<typeof workspace.on>;
			}
		).on("agent-client:cancel-message", (targetViewId?: string) => {
			if (targetViewId && targetViewId !== viewId) {
				return;
			}
			if (!isActive) return;
			void handleStopGeneration();
		});

		return () => {
			workspace.offref(approveRef);
			workspace.offref(rejectRef);
			workspace.offref(cancelRef);
		};
	}, [
		plugin.app.workspace,
		permission.approveActivePermission,
		permission.rejectActivePermission,
		handleStopGeneration,
		viewId,
		isActive,
	]);

	// Handle "Add selection to chat" command (Cmd+L)
	useEffect(() => {
		const workspace = plugin.app.workspace;

		const eventRef = (
			workspace as unknown as {
				on: (
					name: string,
					callback: (text: string) => void,
				) => ReturnType<typeof workspace.on>;
			}
		).on("agent-client:add-selection-to-chat", (text: string) => {
			if (
				plugin.lastActiveChatViewId &&
				plugin.lastActiveChatViewId !== viewId
			) {
				return;
			}
			if (!isActive) return;

			const currentText = inputValue;
			const newText = currentText ? `${currentText}\n${text}` : text;
			setInputValue(newText);

			window.setTimeout(() => {
				const activeTabContainer = view.containerEl.querySelector(
					".agent-client-tab-content:not(.agent-client-tab-content-hidden)",
				);
				const textarea = activeTabContainer?.querySelector(
					"textarea.agent-client-chat-input-textarea",
				);
				if (textarea instanceof HTMLTextAreaElement) {
					textarea.focus();
					textarea.selectionStart = textarea.value.length;
					textarea.selectionEnd = textarea.value.length;
				}
			}, 200);
		});

		return () => {
			workspace.offref(eventRef);
		};
	}, [
		plugin.app.workspace,
		plugin.lastActiveChatViewId,
		viewId,
		inputValue,
		setInputValue,
		view.containerEl,
		isActive,
	]);

	// ============================================================
	// Render
	// ============================================================
	return (
		<>
			<ChatHeader
				agentLabel={activeAgentLabel}
				isUpdateAvailable={isUpdateAvailable}
				hasHistoryCapability={sessionHistory.canShowSessionHistory}
				onNewChat={() => void handleNewChatWithPersist()}
				onExportChat={() => void handleExportChat()}
				onShowMenu={handleShowMenu}
				onOpenHistory={handleOpenHistory}
			/>

			<ChatMessages
				messages={messages}
				isSending={isSending}
				isSessionReady={isSessionReady}
				isRestoringSession={sessionHistory.loading}
				agentLabel={activeAgentLabel}
				plugin={plugin}
				view={view}
				acpClient={acpClientRef.current}
				onApprovePermission={permission.approvePermission}
			/>

			<ChatInput
				isSending={isSending}
				isSessionReady={isSessionReady}
				isRestoringSession={sessionHistory.loading}
				agentLabel={activeAgentLabel}
				availableCommands={session.availableCommands || []}
				autoMentionEnabled={settings.autoMentionActiveNote}
				restoredMessage={restoredMessage}
				mentions={mentions}
				slashCommands={slashCommands}
				autoMention={autoMention}
				plugin={plugin}
				view={view}
				onSendMessage={handleSendMessage}
				onStopGeneration={handleStopGeneration}
				onRestoredMessageConsumed={handleRestoredMessageConsumed}
				modes={session.modes}
				onModeChange={(modeId) => void handleSetMode(modeId)}
				models={session.models}
				onModelChange={(modelId) => void handleSetModel(modelId)}
				supportsImages={session.promptCapabilities?.image ?? false}
				agentId={session.agentId}
				// Controlled component props (for broadcast commands)
				inputValue={inputValue}
				onInputChange={setInputValue}
				attachedImages={attachedImages}
				onAttachedImagesChange={setAttachedImages}
				// Error overlay props
				errorInfo={errorInfo}
				onClearError={handleClearError}
				messages={messages}
			/>
		</>
	);
}

// ============================================================================
// ChatComponent - Tab Container (manages multiple ChatTabContent instances)
// ============================================================================

function ChatComponent({
	plugin,
	view,
	viewId,
}: {
	plugin: AgentClientPlugin;
	view: ChatView;
	viewId: string;
}) {
	// ============================================================
	// Platform Check
	// ============================================================
	if (!Platform.isDesktopApp) {
		throw new Error("Agent Client is only available on desktop");
	}

	// ============================================================
	// Agent ID State (synced with Obsidian view state)
	// ============================================================
	const [restoredAgentId, setRestoredAgentId] = useState<string | undefined>(
		view.getInitialAgentId() ?? undefined,
	);

	// ============================================================
	// Settings (for display settings + default agent)
	// ============================================================
	const settings = useSettings(plugin);

	// ============================================================
	// Session Tabs
	// ============================================================
	const defaultAgentId = restoredAgentId || settings.defaultAgentId || plugin.settings.claude.id;

	// Get initial display name for default agent
	const getAgentDisplayName = useCallback(
		(agentId: string): string => {
			const agents = plugin.getAvailableAgents();
			const agent = agents.find((a) => a.id === agentId);
			return agent?.displayName || agentId;
		},
		[plugin],
	);

	const sessionTabs = useSessionTabs(
		defaultAgentId,
		getAgentDisplayName(defaultAgentId),
	);

	// ============================================================
	// Agent ID Restoration (ChatView-specific)
	// ============================================================
	useEffect(() => {
		const unsubscribe = view.onAgentIdRestored((agentId) => {
			setRestoredAgentId(agentId);
		});
		return unsubscribe;
	}, [view]);

	// ============================================================
	// Focus Tracking (ChatView-specific)
	// ============================================================
	useEffect(() => {
		const handleFocus = () => {
			plugin.setLastActiveChatViewId(viewId);
		};

		const container = view.containerEl;
		container.addEventListener("focus", handleFocus, true);
		container.addEventListener("click", handleFocus);

		// Set as active on mount (first opened view becomes active)
		plugin.setLastActiveChatViewId(viewId);

		return () => {
			container.removeEventListener("focus", handleFocus, true);
			container.removeEventListener("click", handleFocus);
		};
	}, [plugin, viewId, view.containerEl]);

	// ============================================================
	// Tab Callbacks
	// ============================================================
	const handleAddTab = useCallback(() => {
		const agentId = settings.defaultAgentId || plugin.settings.claude.id;
		sessionTabs.addTab(agentId, getAgentDisplayName(agentId));
	}, [sessionTabs, settings.defaultAgentId, plugin.settings.claude.id, getAgentDisplayName]);

	const handleCloseTab = useCallback(
		(tabId: string) => {
			// Clean up adapter for the closing tab
			const tabViewId = sessionTabs.getTabViewId(viewId, tabId);
			void plugin.removeAdapter(tabViewId);
			sessionTabs.removeTab(tabId);
		},
		[sessionTabs, viewId, plugin],
	);

	const handleAgentChange = useCallback(
		(tabId: string, agentLabel: string, agentId: string) => {
			sessionTabs.updateTabAgent(tabId, agentId);
			// Only update title if it's still the default agent name (no first message yet)
			const tab = sessionTabs.tabs.find((t) => t.tabId === tabId);
			if (tab) {
				const currentAgentName = getAgentDisplayName(tab.agentId);
				if (tab.title === currentAgentName || tab.title === getAgentDisplayName(agentId)) {
					sessionTabs.updateTabTitle(tabId, agentLabel);
				}
			}
		},
		[sessionTabs, getAgentDisplayName],
	);

	const handleFirstMessage = useCallback(
		(tabId: string, messagePreview: string) => {
			sessionTabs.updateTabTitle(tabId, messagePreview);
		},
		[sessionTabs],
	);

	// ============================================================
	// Render
	// ============================================================
	const chatFontSizeStyle =
		settings.displaySettings.fontSize !== null
			? ({
					"--ac-chat-font-size": `${settings.displaySettings.fontSize}px`,
				} as React.CSSProperties)
			: undefined;

	return (
		<div
			className="agent-client-chat-view-container"
			style={chatFontSizeStyle}
		>
			<ChatTabBar
				tabs={sessionTabs.tabs}
				activeTabId={sessionTabs.activeTabId}
				onSwitchTab={sessionTabs.switchTab}
				onCloseTab={handleCloseTab}
				onAddTab={handleAddTab}
			/>

			{sessionTabs.tabs.map((tab) => {
				const tabViewId = sessionTabs.getTabViewId(viewId, tab.tabId);
				const isActive = tab.tabId === sessionTabs.activeTabId;

				return (
					<div
						key={tab.tabId}
						className={`agent-client-tab-content ${isActive ? "" : "agent-client-tab-content-hidden"}`}
					>
						<ChatTabContent
							plugin={plugin}
							view={view}
							viewId={viewId}
							tabViewId={tabViewId}
							isActive={isActive}
							initialAgentId={tab.tabId === "tab-0" ? restoredAgentId : undefined}
							onAgentChange={(label, id) =>
								handleAgentChange(tab.tabId, label, id)
							}
							onFirstMessage={(preview) =>
								handleFirstMessage(tab.tabId, preview)
							}
						/>
					</div>
				);
			})}
		</div>
	);
}

/** State stored for view persistence */
interface ChatViewState extends Record<string, unknown> {
	initialAgentId?: string;
}

// Callback types for input state access (broadcast commands)
type GetDisplayNameCallback = () => string;
type GetInputStateCallback = () => ChatInputState | null;
type SetInputStateCallback = (state: ChatInputState) => void;
type SendMessageCallback = () => Promise<boolean>;
type CanSendCallback = () => boolean;
type CancelCallback = () => Promise<void>;

export class ChatView extends ItemView implements IChatViewContainer {
	private root: Root | null = null;
	private plugin: AgentClientPlugin;
	private logger: Logger;
	/** Unique identifier for this view instance (for multi-session support) */
	readonly viewId: string;
	/** View type for IChatViewContainer */
	readonly viewType: ChatViewType = "sidebar";
	/** Initial agent ID passed via state (for openNewChatViewWithAgent) */
	private initialAgentId: string | null = null;
	/** Callbacks to notify React when agentId is restored from workspace state */
	private agentIdRestoredCallbacks: Set<(agentId: string) => void> =
		new Set();

	// Callbacks for input state access (broadcast commands)
	private getDisplayNameCallback: GetDisplayNameCallback | null = null;
	private getInputStateCallback: GetInputStateCallback | null = null;
	private setInputStateCallback: SetInputStateCallback | null = null;
	private sendMessageCallback: SendMessageCallback | null = null;
	private canSendCallback: CanSendCallback | null = null;
	private cancelCallback: CancelCallback | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: AgentClientPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.logger = getLogger();
		// Use leaf.id if available, otherwise generate UUID
		this.viewId = (leaf as { id?: string }).id ?? crypto.randomUUID();
	}

	getViewType() {
		return VIEW_TYPE_CHAT;
	}

	getDisplayText() {
		return "Agent client";
	}

	getIcon() {
		return "bot-message-square";
	}

	/**
	 * Get the view state for persistence.
	 */
	getState(): ChatViewState {
		return {
			initialAgentId: this.initialAgentId ?? undefined,
		};
	}

	/**
	 * Restore the view state from persistence.
	 * Notifies React when agentId is restored so it can re-create the session.
	 */
	async setState(
		state: ChatViewState,
		result: { history: boolean },
	): Promise<void> {
		const previousAgentId = this.initialAgentId;
		this.initialAgentId = state.initialAgentId ?? null;
		await super.setState(state, result);

		// Notify React when agentId is restored and differs from previous value
		if (this.initialAgentId && this.initialAgentId !== previousAgentId) {
			this.agentIdRestoredCallbacks.forEach((cb) =>
				cb(this.initialAgentId!),
			);
		}
	}

	/**
	 * Get the initial agent ID for this view.
	 * Used by ChatComponent to determine which agent to initialize.
	 */
	getInitialAgentId(): string | null {
		return this.initialAgentId;
	}

	/**
	 * Set the agent ID for this view.
	 * Called when agent is switched to persist the change.
	 */
	setAgentId(agentId: string): void {
		this.initialAgentId = agentId;
		// Request workspace to save the updated state
		this.app.workspace.requestSaveLayout();
	}

	/**
	 * Register a callback to be notified when agentId is restored from workspace state.
	 * Used by React components to sync with Obsidian's setState lifecycle.
	 * @returns Unsubscribe function
	 */
	onAgentIdRestored(callback: (agentId: string) => void): () => void {
		this.agentIdRestoredCallbacks.add(callback);
		return () => {
			this.agentIdRestoredCallbacks.delete(callback);
		};
	}

	// ============================================================
	// Input State Callbacks (for broadcast commands)
	// ============================================================

	/**
	 * Register callbacks for input state access.
	 * Called by ChatComponent on mount.
	 */
	registerInputCallbacks(callbacks: {
		getDisplayName: GetDisplayNameCallback;
		getInputState: GetInputStateCallback;
		setInputState: SetInputStateCallback;
		sendMessage: SendMessageCallback;
		canSend: CanSendCallback;
		cancel: CancelCallback;
	}): void {
		this.getDisplayNameCallback = callbacks.getDisplayName;
		this.getInputStateCallback = callbacks.getInputState;
		this.setInputStateCallback = callbacks.setInputState;
		this.sendMessageCallback = callbacks.sendMessage;
		this.canSendCallback = callbacks.canSend;
		this.cancelCallback = callbacks.cancel;
	}

	/**
	 * Unregister callbacks when component unmounts.
	 */
	unregisterInputCallbacks(): void {
		this.getDisplayNameCallback = null;
		this.getInputStateCallback = null;
		this.setInputStateCallback = null;
		this.sendMessageCallback = null;
		this.canSendCallback = null;
		this.cancelCallback = null;
	}

	getDisplayName(): string {
		return this.getDisplayNameCallback?.() ?? "Chat";
	}

	/**
	 * Get current input state (text + images).
	 * Returns null if React component not mounted.
	 */
	getInputState(): ChatInputState | null {
		return this.getInputStateCallback?.() ?? null;
	}

	/**
	 * Set input state (text + images).
	 */
	setInputState(state: ChatInputState): void {
		this.setInputStateCallback?.(state);
	}

	/**
	 * Trigger send message. Returns true if message was sent.
	 */
	async sendMessage(): Promise<boolean> {
		return (await this.sendMessageCallback?.()) ?? false;
	}

	/**
	 * Check if this view can send a message.
	 */
	canSend(): boolean {
		return this.canSendCallback?.() ?? false;
	}

	/**
	 * Cancel current operation.
	 */
	async cancelOperation(): Promise<void> {
		await this.cancelCallback?.();
	}

	// ============================================================
	// IChatViewContainer Implementation
	// ============================================================

	/**
	 * Called when this view becomes the active/focused view.
	 */
	onActivate(): void {
		this.logger.log(`[ChatView] Activated: ${this.viewId}`);
	}

	/**
	 * Called when this view loses active/focused status.
	 */
	onDeactivate(): void {
		this.logger.log(`[ChatView] Deactivated: ${this.viewId}`);
	}

	/**
	 * Programmatically focus this view's input.
	 * Reveals the leaf first so that Obsidian switches to this tab
	 * before focusing the textarea (required for sidebar tabs).
	 */
	focus(): void {
		void this.app.workspace.revealLeaf(this.leaf).then(() => {
			const textarea = this.containerEl.querySelector(
				"textarea.agent-client-chat-input-textarea",
			);
			if (textarea instanceof HTMLTextAreaElement) {
				textarea.focus();
			}
		});
	}

	/**
	 * Check if this view currently has focus.
	 */
	hasFocus(): boolean {
		return this.containerEl.contains(document.activeElement);
	}

	/**
	 * Expand the view if it's in a collapsed state.
	 * Sidebar views don't have expand/collapse state - no-op.
	 */
	expand(): void {
		// Sidebar views don't have expand/collapse state - no-op
	}

	collapse(): void {
		// Sidebar views don't have expand/collapse state - no-op
	}

	/**
	 * Get the DOM container element for this view.
	 */
	getContainerEl(): HTMLElement {
		return this.containerEl;
	}

	onOpen() {
		const container = this.containerEl.children[1];
		container.empty();

		this.root = createRoot(container);
		this.root.render(
			<ChatComponent
				plugin={this.plugin}
				view={this}
				viewId={this.viewId}
			/>,
		);

		// Register with plugin's view registry
		this.plugin.viewRegistry.register(this);

		return Promise.resolve();
	}

	async onClose(): Promise<void> {
		this.logger.log("[ChatView] onClose() called");

		// Unregister from plugin's view registry
		this.plugin.viewRegistry.unregister(this.viewId);

		// Cleanup is handled by React useEffect cleanup in ChatComponent
		// which performs auto-export and closeSession
		if (this.root) {
			this.root.unmount();
			this.root = null;
		}
		// Remove all adapters for this view (including tab-based adapters)
		await this.plugin.removeAdaptersForView(this.viewId);
	}
}
