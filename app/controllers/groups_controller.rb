class GroupsController < ApplicationController
  def index
    @groups = sort(GroupFilter.filter(params))
      .page(params[:page])
      .includes(
        :composers,
        :editions,
        :functions,
        :recordings,
        compositions: [
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

  def sort_order
    case params[:order]
    when "desc"
      "desc"
    else
      "asc"
    end
  end

  def invert_sort_order
    sort_order == "asc" ? "desc" : "asc"
  end
  helper_method :invert_sort_order
end
