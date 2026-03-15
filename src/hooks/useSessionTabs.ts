import { useState, useCallback } from "react";

// ============================================================================
// Types
// ============================================================================

/**
 * Information about a single tab.
 */
export interface TabInfo {
	/** Unique tab identifier */
	tabId: string;
	/** Agent ID for this tab's session */
	agentId: string;
	/** Display title for the tab */
	title: string;
}

/**
 * Return type for useSessionTabs hook.
 */
export interface UseSessionTabsReturn {
	/** List of all tabs */
	tabs: TabInfo[];
	/** Currently active tab ID */
	activeTabId: string;
	/** Whether tab bar should be visible (more than 1 tab) */
	showTabBar: boolean;

	/**
	 * Add a new tab.
	 * @param agentId - Agent ID for the new tab
	 * @param title - Initial title (typically agent display name)
	 * @returns The new tab's ID
	 */
	addTab: (agentId: string, title: string) => string;

	/**
	 * Remove a tab.
	 * If this is the last tab, it will NOT be removed (caller should handle new chat instead).
	 * If removing the active tab, switches to the nearest tab.
	 * @param tabId - Tab to remove
	 */
	removeTab: (tabId: string) => void;

	/**
	 * Switch to a different tab.
	 * @param tabId - Tab to switch to
	 */
	switchTab: (tabId: string) => void;

	/**
	 * Update the title of a tab.
	 * @param tabId - Tab to update
	 * @param title - New title
	 */
	updateTabTitle: (tabId: string, title: string) => void;

	/**
	 * Update the agent ID for a tab (when agent is switched within a tab).
	 * @param tabId - Tab to update
	 * @param agentId - New agent ID
	 */
	updateTabAgent: (tabId: string, agentId: string) => void;

	/**
	 * Generate a unique viewId for a tab's adapter.
	 * @param viewId - The parent view's ID
	 * @param tabId - The tab's ID
	 */
	getTabViewId: (viewId: string, tabId: string) => string;
}

// ============================================================================
// Constants
// ============================================================================

/** Maximum title length for tab display */
const MAX_TAB_TITLE_LENGTH = 30;

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook for managing session tabs within a single ChatView.
 *
 * Each tab represents an independent chat session with its own
 * agent process, messages, and session state.
 *
 * @param defaultAgentId - Default agent ID for new tabs
 * @param defaultTitle - Default title for new tabs (typically agent display name)
 */
export function useSessionTabs(
	defaultAgentId: string,
	defaultTitle: string,
): UseSessionTabsReturn {
	// Tab counter for unique IDs
	const [tabCounter, setTabCounter] = useState(1);

	// Initial tab
	const [tabs, setTabs] = useState<TabInfo[]>(() => [
		{
			tabId: "tab-0",
			agentId: defaultAgentId,
			title: defaultTitle,
		},
	]);

	const [activeTabId, setActiveTabId] = useState("tab-0");

	const showTabBar = tabs.length > 1;

	/**
	 * Add a new tab and switch to it.
	 */
	const addTab = useCallback(
		(agentId: string, title: string): string => {
			const newTabId = `tab-${tabCounter}`;
			setTabCounter((prev) => prev + 1);

			const newTab: TabInfo = {
				tabId: newTabId,
				agentId,
				title,
			};

			setTabs((prev) => [...prev, newTab]);
			setActiveTabId(newTabId);

			return newTabId;
		},
		[tabCounter],
	);

	/**
	 * Remove a tab.
	 */
	const removeTab = useCallback(
		(tabId: string) => {
			setTabs((prev) => {
				// Don't remove the last tab
				if (prev.length <= 1) {
					return prev;
				}

				const index = prev.findIndex((t) => t.tabId === tabId);
				if (index === -1) return prev;

				const newTabs = prev.filter((t) => t.tabId !== tabId);

				// If removing the active tab, switch to nearest
				if (tabId === activeTabId) {
					const newActiveIndex = Math.min(index, newTabs.length - 1);
					setActiveTabId(newTabs[newActiveIndex].tabId);
				}

				return newTabs;
			});
		},
		[activeTabId],
	);

	/**
	 * Switch to a tab.
	 */
	const switchTab = useCallback((tabId: string) => {
		setActiveTabId(tabId);
	}, []);

	/**
	 * Update tab title.
	 */
	const updateTabTitle = useCallback((tabId: string, title: string) => {
		const truncated =
			title.length > MAX_TAB_TITLE_LENGTH
				? title.substring(0, MAX_TAB_TITLE_LENGTH) + "..."
				: title;

		setTabs((prev) =>
			prev.map((t) => (t.tabId === tabId ? { ...t, title: truncated } : t)),
		);
	}, []);

	/**
	 * Update tab agent ID.
	 */
	const updateTabAgent = useCallback((tabId: string, agentId: string) => {
		setTabs((prev) =>
			prev.map((t) => (t.tabId === tabId ? { ...t, agentId } : t)),
		);
	}, []);

	/**
	 * Generate a unique viewId for adapter keying.
	 */
	const getTabViewId = useCallback(
		(viewId: string, tabId: string): string => {
			return `${viewId}-${tabId}`;
		},
		[],
	);

	return {
		tabs,
		activeTabId,
		showTabBar,
		addTab,
		removeTab,
		switchTab,
		updateTabTitle,
		updateTabAgent,
		getTabViewId,
	};
}
