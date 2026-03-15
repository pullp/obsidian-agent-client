import * as React from "react";
import { setIcon } from "obsidian";
import type { TabInfo } from "../../hooks/useSessionTabs";

const { useEffect, useRef, useCallback } = React;

// ============================================================================
// Types
// ============================================================================

export interface ChatTabBarProps {
	/** List of tabs */
	tabs: TabInfo[];
	/** Currently active tab ID */
	activeTabId: string;
	/** Callback when a tab is clicked */
	onSwitchTab: (tabId: string) => void;
	/** Callback when a tab's close button is clicked */
	onCloseTab: (tabId: string) => void;
	/** Callback when the add button is clicked */
	onAddTab: () => void;
}

// ============================================================================
// Sub-components
// ============================================================================

/**
 * Obsidian-compatible icon button (uses setIcon for SVG rendering).
 */
function TabIconButton({
	iconName,
	className,
	tooltip,
	onClick,
}: {
	iconName: string;
	className: string;
	tooltip: string;
	onClick: (e: React.MouseEvent) => void;
}) {
	const ref = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		if (ref.current) {
			ref.current.empty();
			setIcon(ref.current, iconName);
		}
	}, [iconName]);

	return (
		<button
			ref={ref}
			className={className}
			aria-label={tooltip}
			title={tooltip}
			onClick={onClick}
		/>
	);
}

// ============================================================================
// ChatTabBar Component
// ============================================================================

/**
 * Horizontal tab bar for switching between chat sessions.
 *
 * Design:
 * - Sits below ChatHeader
 * - Each tab shows title + close button
 * - "+" button to add new tab
 * - Matches Obsidian's native tab styling
 */
export function ChatTabBar({
	tabs,
	activeTabId,
	onSwitchTab,
	onCloseTab,
	onAddTab,
}: ChatTabBarProps) {
	const handleCloseTab = useCallback(
		(e: React.MouseEvent, tabId: string) => {
			e.stopPropagation(); // Prevent tab switch when clicking close
			onCloseTab(tabId);
		},
		[onCloseTab],
	);

	return (
		<div className="agent-client-tab-bar">
			<div className="agent-client-tab-bar-tabs">
				{tabs.map((tab) => (
					<button
						key={tab.tabId}
						className={`agent-client-tab ${tab.tabId === activeTabId ? "agent-client-tab-active" : ""}`}
						onClick={() => onSwitchTab(tab.tabId)}
						title={tab.title}
					>
						<span className="agent-client-tab-title">{tab.title}</span>
						{tabs.length > 1 && (
							<TabIconButton
								iconName="x"
								className="agent-client-tab-close"
								tooltip="Close tab"
								onClick={(e) => handleCloseTab(e, tab.tabId)}
							/>
						)}
					</button>
				))}
			</div>
			<TabIconButton
				iconName="plus"
				className="agent-client-tab-add"
				tooltip="New tab"
				onClick={onAddTab}
			/>
		</div>
	);
}
