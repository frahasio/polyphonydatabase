export default function addTitleSelect() {
  $(document).ready(function () {
    var select = $(".title").select2({
      ajax: {
        url: "/admin/titles",
        dataType: "json"
      }
    })

    if (select.hasClass("composition-list-title")) {
      select.on("select2:select", function (e) {
        window.location.href = "/admin/compositions?title_id=" + e.params.data.id;
      })
    }
  })
}
