export default function addComposersSelect() {
  $(document).ready(function () {
    var select = $(".composers").select2({
      ajax: {
        url: "/admin/composers",
        dataType: "json"
      }
    })
  })
}
