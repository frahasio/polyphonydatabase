class GroupsController < ApplicationController
  def index
    @groups = GroupFilter.filter(params)
      .order(:display_title)
      .limit(200)
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
