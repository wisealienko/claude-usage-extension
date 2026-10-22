// Нажатие на иконку -> команда плашке на текущей вкладке
chrome.action.onClicked.addListener(tab => {
  chrome.tabs.sendMessage(tab.id, { type: 'toggle' }).catch(() => {});
});
