class GroupsController < ApplicationController
  def index
    @groups = sort(GroupFilter.filter(params))
      .page(params[:page])
      .per(params[:page_size])
      .includes(
        :composers,
        :editions,
        :functions,
        :recordings,
        compositions: [
          :composition_type,
          inclusions: [
            :attributions,
            :clef_combination,
            :source,
          ],
        ],
      )
  end

  private

  # Add more sort options here as needed
  def sort(scope)
    case params[:sort]
    when "title"
      scope.order(display_title: sort_order)
    else
      scope.order(:display_title)
    end
  end
end
