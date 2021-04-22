class GroupsController < ApplicationController
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
    @groups = Kaminari.paginate_array(@groups)
        .page(params[:page])
        .per(40)
  end
end
