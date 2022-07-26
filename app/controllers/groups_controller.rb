class GroupsController < ApplicationController
  @groups = Kaminari.paginate_array(@groups)
      .page(params[:page])
      .per(100)
  def index
    @groups = GroupFilter.filter(params)
      .order(:display_title)
      .includes(
        :recordings,
        :functions,
        compositions: [
          :composers,
          inclusions: [
            :source,
          ],
        ],
        editions: [
          :editor,
        ],
      )
  end
end
