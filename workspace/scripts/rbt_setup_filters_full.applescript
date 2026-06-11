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
	
	-- Step 1: Cancel recover prompt
	set js to "(function(){var iframe=document.querySelector('iframe');var doc=iframe.contentDocument||iframe.contentWindow.document;var divs=doc.querySelectorAll('div');for(var i=0;i<divs.length;i++){if(divs[i].innerText.trim()==='取消'&&divs[i].offsetHeight>0){divs[i].click();return 'cancel_clicked';}}return 'cancel_not_found';})()"
	set r1 to execute tab_ javascript js
	delay 1
	
	-- Step 2: Click 清除 (clear all filters)
	set js2 to "(function(){var iframe=document.querySelector('iframe');var doc=iframe.contentDocument||iframe.contentWindow.document;var divs=doc.querySelectorAll('div');for(var i=0;i<divs.length;i++){if(divs[i].innerText.trim()==='清除'&&divs[i].offsetHeight>0){divs[i].click();return 'clear_clicked';}}return 'clear_not_found';})()"
	set r2 to execute tab_ javascript js2
	delay 1
	
	-- Step 3: Select 院校 - 985
	set js3 to "(function(){var iframe=document.querySelector('iframe');var doc=iframe.contentDocument||iframe.contentWindow.document;var divs=doc.querySelectorAll('div.option');for(var i=0;i<divs.length;i++){if(divs[i].innerText.trim()==='985'){divs[i].click();return '985_clicked';}}return '985_not_found';})()"
	set r3 to execute tab_ javascript js3
	delay 1
	
	-- Step 4: Select 院校 - 国内外名校
	set js4 to "(function(){var iframe=document.querySelector('iframe');var doc=iframe.contentDocument||iframe.contentWindow.document;var divs=doc.querySelectorAll('div.option');for(var i=0;i<divs.length;i++){if(divs[i].innerText.trim()==='国内外名校'){divs[i].click();return '名校_clicked';}}return '名校_not_found';})()"
	set r4 to execute tab_ javascript js4
	delay 1
	
	-- Step 5: Select 经验要求 - 在校/应届
	set js5 to "(function(){var iframe=document.querySelector('iframe');var doc=iframe.contentDocument||iframe.contentWindow.document;var divs=doc.querySelectorAll('div.option');for(var i=0;i<divs.length;i++){if(divs[i].innerText.trim()==='在校/应届'){divs[i].click();return '应届_clicked';}}return '应届_not_found';})()"
	set r5 to execute tab_ javascript js5
	delay 1
	
	-- Step 6: Select 经验要求 - 25年毕业
	set js6 to "(function(){var iframe=document.querySelector('iframe');var doc=iframe.contentDocument||iframe.contentWindow.document;var divs=doc.querySelectorAll('div.option');for(var i=0;i<divs.length;i++){if(divs[i].innerText.trim()==='25年毕业'){divs[i].click();return '25_clicked';}}return '25_not_found';})()"
	set r6 to execute tab_ javascript js6
	delay 1
	
	-- Step 7: Select 经验要求 - 26年毕业
	set js7 to "(function(){var iframe=document.querySelector('iframe');var doc=iframe.contentDocument||iframe.contentWindow.document;var divs=doc.querySelectorAll('div.option');for(var i=0;i<divs.length;i++){if(divs[i].innerText.trim()==='26年毕业'){divs[i].click();return '26_clicked';}}return '26_not_found';})()"
	set r7 to execute tab_ javascript js7
	delay 1
	
	-- Step 8: Select 经验要求 - 1年以内
	set js8 to "(function(){var iframe=document.querySelector('iframe');var doc=iframe.contentDocument||iframe.contentWindow.document;var divs=doc.querySelectorAll('div.option');for(var i=0;i<divs.length;i++){if(divs[i].innerText.trim()==='1年以内'){divs[i].click();return '1y_clicked';}}return '1y_not_found';})()"
	set r8 to execute tab_ javascript js8
	delay 1
	
	-- Step 9: Select 经验要求 - 1-3年
	set js9 to "(function(){var iframe=document.querySelector('iframe');var doc=iframe.contentDocument||iframe.contentWindow.document;var divs=doc.querySelectorAll('div.option');for(var i=0;i<divs.length;i++){if(divs[i].innerText.trim()==='1-3年'){divs[i].click();return '13y_clicked';}}return '13y_not_found';})()"
	set r9 to execute tab_ javascript js9
	delay 1
	
	-- Step 10: Click 确定
	set js10 to "(function(){var iframe=document.querySelector('iframe');var doc=iframe.contentDocument||iframe.contentWindow.document;var divs=doc.querySelectorAll('div');for(var i=0;i<divs.length;i++){if(divs[i].innerText.trim()==='确定'&&divs[i].offsetHeight>0){divs[i].click();return 'confirm_clicked';}}return 'confirm_not_found';})()"
	set r10 to execute tab_ javascript js10
	delay 2
	
	return r1 & ' ' & r2 & ' ' & r3 & ' ' & r4 & ' ' & r5 & ' ' & r6 & ' ' & r7 & ' ' & r8 & ' ' & r9 & ' ' & r10
end tell
