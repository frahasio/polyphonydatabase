/*!
* formNavigation
* Copyright 2013 Ole Bjørn Michelsen <http://ole.michelsen.dk/>
* MIT license
*/
(function ($) {
    $.fn.formNavigation = function () {
        $(this).each(function () {
            $(this).find('textarea').on('keyup', function(e) {
                switch (e.which) {
                    case 39:
                        $(this).closest('td').next().find('textarea').focus(); break;
                    case 37:
                        $(this).closest('td').prev().find('textarea').focus(); break;
                    case 40:
                        $(this).closest('tr').next().children().eq($(this).closest('td').index()).find('textarea').focus(); break;
                    case 38:
                        $(this).closest('tr').prev().children().eq($(this).closest('td').index()).find('textarea').focus(); break;
                }
            });
        });
    };
})(jQuery);
