export default function addTitleSelect() {
  $(document).ready(function () {
    var select = $("select.title").select2({
      ajax: {
        url: "/admin/titles",
        dataType: "json",
        data: function (params) {
          var select = this[0]

          return {
            q: params.term,
            language: select.dataset.language,
          }
        },
      },
      tags: true,
    })

    if (select.hasClass("composition-list-title")) {
      select.on("select2:select", function (e) {
        window.location.href = "/admin/compositions?title_id=" + e.params.data.id;
      })
    }
  })
}
