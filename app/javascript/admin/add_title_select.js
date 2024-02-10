export default function addTitleSelect() {
  $(document).ready(
    $(".composition-title")
      .select2({
        ajax: {
          url: "/admin/titles",
          dataType: "json"
        }
      })
      .on("select2:select", function(e) {
        window.location.href = "/admin/compositions?title_id=" + e.params.data.id;
      })
  )
}
