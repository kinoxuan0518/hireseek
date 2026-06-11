tell application "Google Chrome"
	set tab_ to null
	repeat with w from 1 to count of windows
		repeat with t from 1 to count of tabs of window w
			if URL of tab t of window w contains "zhipin.com/web/chat" then
				set tab_ to tab t of window w
				exit repeat
			end if
		end repeat
		if tab_ is not null then exit repeat
	end repeat
	
	-- First, try to find the dropdown trigger - it's the element showing "Agent 开发工程师 _ 上海 30-60K"
	set js to "(function(){var iframe=document.querySelector('iframe');var doc=iframe.contentDocument||iframe.contentWindow.document;var divs=doc.querySelectorAll('div[class*=job],div[class*=Job],div[class*=Job],.job-select-area');for(var i=0;i<divs.length;i++){var t=divs[i].innerText;if(t.indexOf('Agent')>=0&&t.indexOf('开发')>=0&&t.length<50&&divs[i].offsetHeight>0){divs[i].click();return 'trigger_clicked';}}return 'trigger_not_found';})()"
	set r to execute tab_ javascript js
	delay 1
	
	-- Check if dropdown opened (more job items visible)
	set js2 to "(function(){var iframe=document.querySelector('iframe');var doc=iframe.contentDocument||iframe.contentWindow.document;var items=doc.querySelectorAll('div');var r='';for(var i=0;i<items.length;i++){var t=items[i].innerText.trim();if(t.indexOf('大模型')>=0&&t.length<40&&items[i].offsetHeight>0){r+=i+':'+t.substring(0,40)+' ';}}return r||'no_bigmodel_items';})()"
	set r2 to execute tab_ javascript js2
	return r & ' | ' & r2
end tell