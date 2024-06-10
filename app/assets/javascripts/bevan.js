// Autofill composers with values in first inclusion row
$( document ).ready(function(){
	$('.autofill-composers').click(function(){
		$('ul.composer li:first-child input').val($('ul.composer:first-of-type li:first-child input').val());
		$('ul.composer li:first-child select').val($('ul.composer:first-of-type li:first-child select').val());
	})
	$('.autofill-language').click(function(){
		$('div.inclusion div.language select').val($('div.inclusion div.language select:first-of-type').val());
	})
	$('.autofill-composition-type').click(function(){
		$('div.inclusion div.type select').val($('div.inclusion div.type select:first-of-type').val());
	})
});

// Autoupdate voice count input as clefs are changed
$( document ).ready(function(){
	$('.clefs input').on('change', function(e){
	    	var rowIndex = $(this).closest('.body-row').index('.body-row');
	    	var tally = 0;
	    	var inputsToUpdate = $('.body-row').eq(rowIndex).find('.voice-count input');
		console.log(rowIndex);
		$('.body-row').eq(rowIndex).find('.clefs input').each(function(i,e) {
			console.log($(e).val());
			console.log($(e).attr('type'));
			if (!$(e).val() || $(e).attr('type') == 'hidden' || $(e).val().indexOf("(") !== -1 || $(e).val().indexOf(")") !== -1 || $(e).val().indexOf("bc") !== -1 || $(e).val().indexOf("lut") !== -1 || $(e).val().indexOf("org") !== -1) {
				// do nothing
			} else {
				tally = tally + 1;
			};
		});
		console.log(tally);
		inputsToUpdate.val(tally);
	});
});

// Toggle menu with burger button
$( document ).ready(function(){
	$('.burger').click(function(){
		$(this).parents('.nav').toggleClass('open');
	})
});

// Show extra attribution input
$( document ).ready(function(){
	$('.another-att-trigger').click(function(){
		$(this).siblings('.composer').find('li:last-of-type').addClass('visible');
	})
});
