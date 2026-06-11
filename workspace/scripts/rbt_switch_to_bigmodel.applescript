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
	
	-- Step 1: Click dropdown trigger - the visible Agent text
	set js1 to "(function(){var iframe=document.querySelector('iframe');var doc=iframe.contentDocument||iframe.contentWindow.document;var all=doc.querySelectorAll('DIV');for(var i=0;i<all.length;i++){var h=all[i].offsetHeight;if(h<1){continue;}var t=all[i].innerText;if(t.indexOf('Agent 开发工程师')!=-1&&t.length<60){all[i].click();return 'trigger_clicked';}}return 'trigger_not_found';})()"
	set r1 to execute tab_ javascript js1
	delay 1
	
	-- Step 2: Click big model job in the dropdown
	set js2 to "(function(){var iframe=document.querySelector('iframe');var doc=iframe.contentDocument||iframe.contentWindow.document;var all=doc.querySelectorAll('LI');for(var i=0;i<all.length;i++){var t=all[i].innerText;if(t.indexOf('大模型算法工程师-工业智能')!=-1){all[i].click();return 'bigmodel_clicked';}}return 'bigmodel_not_found';})()"
	set r2 to execute tab_ javascript js2
	delay 2
	
	-- Step 3: Verify - check current job label
	set js3 to "(function(){var iframe=document.querySelector('iframe');var doc=iframe.contentDocument||iframe.contentWindow.document;var all=doc.querySelectorAll('DIV');for(var i=0;i<all.length;i++){var t=all[i].innerText;if(t.indexOf('大模型算法工程师')!=-1&&t.length<60&&all[i].offsetHeight>0){return 'verified:'+t.substring(0,30);}}return 'verify_not_found';})()"
	set r3 to execute tab_ javascript js3
	
	return r1 & " | " & r2 & " | " & r3
end tell