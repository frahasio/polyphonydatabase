class GroupsController < ApplicationController
  def index
    @groups = GroupFilter.filter(params)
      .order(:display_title)
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
end
